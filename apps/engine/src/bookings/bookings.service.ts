import { Injectable } from '@nestjs/common';
import { BookingRecord, CreateBooking, EventRecord, Page } from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { entitySk, gsi1UserPk, gsi1UserSk, skPrefix } from '../persistence/keys';
import { currentPrincipal } from '../common/tenant-context';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';
import { conflictedTransactionIndexes, failedTransactionIndexes } from '../common/transaction-errors';

// The HTTP-facing shape of a booking. `BookingRecord` (from @marketplace/contracts) mirrors
// exactly what is stored in DynamoDB, including the single-table `PK`/`SK` attributes and the
// `GSI1PK`/`GSI1SK` attributes used to index bookings by owning user. Those are a
// persistence-layer implementation detail and are deliberately not part of the public API
// surface: clients should never see, depend on, or be able to parse the internal key scheme.
export type BookingResponse = Omit<BookingRecord, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK'>;

function toResponse(record: BookingRecord): BookingResponse {
  const { PK: _pk, SK: _sk, GSI1PK: _gsi1pk, GSI1SK: _gsi1sk, ...rest } = record;
  return rest;
}

// Transaction item index 0 is always the event's capacity claim below; item 1 is always the
// booking Put. `create`'s failure handling relies on this exact ordering to map a failed or
// contended transaction index back to what actually happened -- do not reorder or interleave
// these without updating that handling too.
const EVENT_UPDATE_INDEX = 0;

@Injectable()
export class BookingsService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly registry: SchemaRegistryService,
  ) {}

  async create(input: CreateBooking): Promise<BookingResponse> {
    const event = await this.repo.get<EventRecord>(entitySk('Event', input.eventId));
    if (!event) {
      throw new ProblemException('invalid-request', 422, 'Unknown event', `no event ${input.eventId}`, {
        eventId: input.eventId,
      });
    }

    const attributes = await this.registry.validate('Booking', input.attributes);

    const principal = currentPrincipal();
    const id = newId();
    const createdAt = new Date().toISOString();

    const record: BookingResponse = {
      entityType: 'Booking',
      id,
      eventId: input.eventId,
      userId: principal.userId,
      status: 'confirmed',
      ticketQuantity: input.ticketQuantity,
      createdAt,
      attributes,
    };

    const fullRecord: BookingRecord = {
      ...record,
      ...this.repo.key(entitySk('Booking', id)),
      GSI1PK: gsi1UserPk(principal.tenantId, principal.userId),
      GSI1SK: gsi1UserSk('Booking', createdAt, id),
    };

    // Item 0 (EVENT_UPDATE_INDEX) is the capacity claim: it can only commit if `bookedCount`
    // stays within `capacity`, evaluated atomically by DynamoDB alongside the Put below. There
    // is no read-then-write window here -- the increment and the capacity check happen as a
    // single conditional write, which is what makes overselling structurally impossible rather
    // than merely unlikely under concurrency.
    //
    // DynamoDB's ConditionExpression grammar supports only comparisons (`<=`, `=`, ...), not
    // arithmetic -- `#booked + :qty <= #capacity` is a ValidationException ("Invalid
    // ConditionExpression: Syntax error; token: '+'"), even though the same arithmetic is legal
    // in an UpdateExpression's SET clause. So the capacity threshold is computed here, from the
    // event this request already read, and compared directly: `#booked <= :maxAllowed`. Item 1
    // is the booking record itself.
    const maxAllowed = event.capacity - input.ticketQuantity;
    try {
      await this.repo.transactWrite([
        {
          Update: {
            TableName: this.repo.tableName,
            Key: this.repo.key(entitySk('Event', input.eventId)),
            UpdateExpression: 'SET #booked = #booked + :qty',
            ConditionExpression: '#booked <= :maxAllowed',
            ExpressionAttributeNames: { '#booked': 'bookedCount' },
            ExpressionAttributeValues: { ':qty': input.ticketQuantity, ':maxAllowed': maxAllowed },
          },
        },
        {
          Put: {
            TableName: this.repo.tableName,
            Item: fullRecord,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ]);
    } catch (err) {
      await this.explainFailure(err, input);
      throw err;
    }

    return record;
  }

  /** Turns a cancelled transaction into the specific problem that caused it. */
  private async explainFailure(err: unknown, input: CreateBooking): Promise<never | void> {
    // A failed ConditionExpression on the capacity claim takes priority over a bare contention
    // signal: if we can tell the caller exactly how many tickets remain, that is strictly more
    // useful than "retry".
    if (failedTransactionIndexes(err).includes(EVENT_UPDATE_INDEX)) {
      const current = await this.repo.get<EventRecord>(entitySk('Event', input.eventId));
      const remaining = current ? current.capacity - current.bookedCount : 0;
      throw new ProblemException(
        'event-at-capacity',
        409,
        'Event at capacity',
        `${remaining} ticket(s) remain, ${input.ticketQuantity} requested`,
        { eventId: input.eventId, remaining, requested: input.ticketQuantity },
      );
    }

    // No ConditionExpression failed, but the transaction was still cancelled: on a real table,
    // concurrent transactions racing on the same event routinely produce `TransactionConflict`
    // instead of `ConditionalCheckFailed`. DynamoDB Local's concurrency model tends to surface
    // only the latter, so this branch is easy to leave untested locally -- without it, this
    // falls through, the raw AWS error propagates, and ProblemFilter maps it to an unhelpful
    // 500 for what is actually a routine, retryable race. This is exactly the failure mode
    // spec e2e invariant 2 (20 concurrent bookings against capacity: 1) would hit against a
    // real table without this handling.
    if (conflictedTransactionIndexes(err).length > 0) {
      throw new ProblemException(
        'transaction-conflict',
        409,
        'Concurrent write conflict',
        `event ${input.eventId} was updated by another request at the same moment; retry`,
        { eventId: input.eventId },
      );
    }
  }

  async get(id: string): Promise<BookingResponse> {
    const found = await this.repo.get<BookingRecord>(entitySk('Booking', id));
    // Cross-tenant access already 404s because `repo.get` is scoped to the current tenant's
    // partition -- a lookup from another tenant simply finds nothing. Ownership within the same
    // tenant is a separate check: `listForCurrentUser` is scoped to the caller's own bookings via
    // the GSI1 user index, and `get` must agree with it, or any authenticated user of a tenant
    // could read any other user's booking just by knowing its id. Reported as 404, not 403 -- per
    // the project-wide rule that a 403 would itself leak that the booking exists, just to someone
    // who isn't allowed to see it. The response is byte-identical to the genuine not-found case
    // (same status, same problem type, no distinguishing detail) so neither channel leaks
    // existence.
    if (!found || found.userId !== currentPrincipal().userId) {
      throw new ProblemException('not-found', 404, 'Booking not found');
    }
    return toResponse(found);
  }

  async listForCurrentUser(limit: number, cursor: string | null): Promise<Page<BookingResponse>> {
    const page = await this.repo.queryUserIndex<BookingRecord>(
      currentPrincipal().userId,
      skPrefix('Booking'),
      { limit, cursor },
    );
    return { items: page.items.map(toResponse), nextCursor: page.nextCursor };
  }
}
