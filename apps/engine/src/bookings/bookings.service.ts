import { Injectable } from '@nestjs/common';
import {
  BookingRecord,
  BookingResponse,
  CreateBooking,
  EventRecord,
  orderReferenceFrom as bookingReferenceFrom,
  Page,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { entitySk, gsi1UserPk, gsi1UserSk, skPrefix } from '../persistence/keys';
import { currentPrincipal } from '../common/tenant-context';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';
import { assertAdmin } from '../common/roles';
import { NotificationsService } from '../notifications/notifications.service';
import { bookingConfirmation } from '../notifications/messages';
import { StorefrontService } from '../storefront/storefront.service';
import { conflictedTransactionIndexes, failedTransactionIndexes } from '../common/transaction-errors';

// The HTTP-facing shape of a booking. `BookingRecord` (from @marketplace/contracts) mirrors
// exactly what is stored in DynamoDB, including the single-table `PK`/`SK` attributes and the
// `GSI1PK`/`GSI1SK` attributes used to index bookings by owning user. Those are a
// persistence-layer implementation detail and are deliberately not part of the public API
// surface: clients should never see, depend on, or be able to parse the internal key scheme.
//
// Defined as `z.infer<typeof BookingResponseSchema>` in @marketplace/contracts rather than as
// an `Omit<BookingRecord, ...>` here, so the browser client has a runtime schema to validate
// against and cannot drift from the type this service returns.
export type { BookingResponse };

function toResponse(record: BookingRecord): BookingResponse {
  const { PK: _pk, SK: _sk, GSI1PK: _gsi1pk, GSI1SK: _gsi1sk, ...rest } = record;
  // Derived for a booking written before references existed, the same way an
  // order's is: the function is pure over the id.
  return { ...rest, reference: rest.reference ?? bookingReferenceFrom(rest.id) };
}

// Transaction item index 0 is always the event's capacity claim below; item 1 is always the
// booking Put. `create`'s failure handling relies on this exact ordering to map a failed or
// contended transaction index back to what actually happened -- do not reorder or interleave
// these without updating that handling too.
const EVENT_UPDATE_INDEX = 0;
const BOOKING_PUT_INDEX = 1;

@Injectable()
export class BookingsService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly registry: SchemaRegistryService,
    private readonly notifications: NotificationsService,
    private readonly storefront: StorefrontService,
  ) {}

  async create(
    input: CreateBooking,
    opts: { guestEmail?: string; attendeeName?: string; attendeePhone?: string } = {},
  ): Promise<BookingResponse> {
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
      // The number a shopper reads back, and the address a stranger finds it
      // with -- both the same shape as an order's, because they are the same
      // problem: a booking outlives the browser that made it.
      reference: bookingReferenceFrom(id),
      ...(opts.guestEmail ? { guestEmail: opts.guestEmail } : {}),
      // Spread conditionally: DynamoDB refuses an explicit `undefined`.
      ...(opts.attendeeName ? { attendeeName: opts.attendeeName } : {}),
      ...(opts.attendeePhone ? { attendeePhone: opts.attendeePhone } : {}),
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
    // is no read-then-write window for `bookedCount` here -- the increment and the capacity
    // check happen as a single conditional write, which is what makes overselling structurally
    // impossible rather than merely unlikely under concurrency.
    //
    // DynamoDB's ConditionExpression grammar supports only comparisons (`<=`, `=`, ...), not
    // arithmetic -- `#booked + :qty <= #capacity` is a ValidationException ("Invalid
    // ConditionExpression: Syntax error; token: '+'"), even though the same arithmetic is legal
    // in an UpdateExpression's SET clause. So the capacity threshold is computed here, from the
    // event this request already read, and compared directly: `#booked <= :maxAllowed`.
    //
    // `capacity` itself IS read-then-written, though: `maxAllowed` is derived from the `event`
    // read at the top of this method, before the transaction runs. Nothing so far pins that
    // value, so `#capacity = :capacity` is added to the condition to close that window -- if
    // `capacity` changes between the read and the commit (there is no endpoint that does this
    // today, but the condition must not depend on that staying true), the whole transaction is
    // cancelled rather than committing against a stale threshold. This mirrors
    // `orders.service.ts`'s `#price = :expectedPrice` guard against a concurrent price edit.
    // Item 1 is the booking record itself.
    const maxAllowed = event.capacity - input.ticketQuantity;
    try {
      await this.repo.transactWrite([
        {
          Update: {
            TableName: this.repo.tableName,
            Key: this.repo.key(entitySk('Event', input.eventId)),
            UpdateExpression: 'SET #booked = #booked + :qty',
            ConditionExpression: '#booked <= :maxAllowed AND #capacity = :capacity',
            ExpressionAttributeNames: { '#booked': 'bookedCount', '#capacity': 'capacity' },
            ExpressionAttributeValues: {
              ':qty': input.ticketQuantity,
              ':maxAllowed': maxAllowed,
              ':capacity': event.capacity,
            },
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
      await this.explainFailure(err, input, id);
      throw err;
    }

    // The class is a place and a time, and until now a stranger who booked one
    // got a web page and nothing else. Best effort by construction.
    if (opts.guestEmail) {
      const shopName = (await this.storefront.getPublished())?.businessProfile?.name ??
        currentPrincipal().tenantId;
      const { subject, body } = bookingConfirmation(
        record,
        event.title,
        new Date(event.startDate).toUTCString(),
        event.location,
        shopName,
      );
      await this.notifications.send({
        kind: 'booking-confirmation',
        to: opts.guestEmail,
        subject,
        body,
        about: record.reference,
      });
    }

    return record;
  }

  /** Turns a cancelled transaction into the specific problem that caused it. */
  private async explainFailure(err: unknown, input: CreateBooking, id: string): Promise<never | void> {
    // A failed ConditionExpression on the capacity claim takes priority over a bare contention
    // signal: if we can tell the caller exactly how many tickets remain, that is strictly more
    // useful than "retry".
    if (failedTransactionIndexes(err).includes(EVENT_UPDATE_INDEX)) {
      const current = await this.repo.get<EventRecord>(entitySk('Event', input.eventId));

      // The event that failed its condition may have been deleted entirely between our read and
      // the transaction's write -- that is a categorically different problem from "sold out"
      // (`current?.capacity ?? 0` would otherwise silently report "0 ticket(s) remain",
      // misleading the caller into thinking the event still exists but has no tickets left).
      // There is no delete-event endpoint today, but `get` and `explainFailure` must agree on
      // what "gone" means regardless.
      if (current === null) {
        throw new ProblemException(
          'not-found',
          404,
          'Event no longer exists',
          `event ${input.eventId} was removed before the booking could be completed`,
          { eventId: input.eventId },
        );
      }

      const remaining = current.capacity - current.bookedCount;
      throw new ProblemException(
        'event-at-capacity',
        409,
        'Event at capacity',
        `${remaining} ticket(s) remain, ${input.ticketQuantity} requested`,
        { eventId: input.eventId, remaining, requested: input.ticketQuantity },
      );
    }

    // `attribute_not_exists(PK)` on the booking Put fails only if a booking with this ULID
    // already exists -- practically unreachable given ULID collision odds, but an unmapped
    // cancellation reason here would otherwise fall through to a raw AWS error and an
    // unhelpful 500 instead of a definite problem.
    if (failedTransactionIndexes(err).includes(BOOKING_PUT_INDEX)) {
      throw new ProblemException(
        'internal-error',
        500,
        'Booking id collision',
        `booking id ${id} already exists`,
        { bookingId: id },
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
    // A tenant admin may read any booking in their own tenant: they run the
    // event, and the shop-wide list below already shows them every row. Same
    // shape as orders.
    const principal = currentPrincipal();
    if (!found || (found.userId !== principal.userId && principal.role !== 'admin')) {
      throw new ProblemException('not-found', 404, 'Booking not found');
    }
    return toResponse(found);
  }

  /**
   * Every booking in the tenant, newest first. Admin only: this is the seller's
   * attendance list, and it deliberately crosses the per-user scoping that
   * `listForCurrentUser` applies, so it is gated rather than filtered.
   */
  async listForTenant(limit: number, cursor: string | null): Promise<Page<BookingResponse>> {
    assertAdmin('list the shop bookings');
    const page = await this.repo.queryPrefix<BookingRecord>(skPrefix('Booking'), { limit, cursor });
    return { items: page.items.map(toResponse), nextCursor: page.nextCursor };
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
