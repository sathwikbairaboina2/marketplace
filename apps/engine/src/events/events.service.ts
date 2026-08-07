import { Injectable } from '@nestjs/common';
import { CreateEvent, EventRecord, EventResponse, Page } from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { entitySk, skPrefix } from '../persistence/keys';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';

// The HTTP-facing shape of an event. `EventRecord` (from @marketplace/contracts) mirrors
// exactly what is stored in DynamoDB, including the single-table `PK`/`SK` attributes. Those
// are a persistence-layer implementation detail -- the tenant-scoped partition key and the
// entity-prefixed sort key -- and are deliberately not part of the public API surface: clients
// should never see, depend on, or be able to parse the internal key scheme.
//
// Defined as `z.infer<typeof EventResponseSchema>` in @marketplace/contracts rather than as an
// `Omit<EventRecord, ...>` here, so the browser client has a runtime schema to validate against
// and cannot drift from the type this service returns.
export type { EventResponse };

function toResponse(record: EventRecord): EventResponse {
  const { PK: _pk, SK: _sk, ...rest } = record;
  return rest;
}

@Injectable()
export class EventsService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly registry: SchemaRegistryService,
  ) {}

  async create(input: CreateEvent): Promise<EventResponse> {
    const attributes = await this.registry.validate('Event', input.attributes);
    const id = newId();

    // `bookedCount` starts at 0 on every event. Task 14's capacity-enforcing transaction
    // conditions on `bookedCount + :qty <= capacity`; if this attribute were ever missing,
    // that condition expression would evaluate against a missing attribute and fail every
    // booking. Initializing it here, unconditionally, is what makes that invariant testable.
    const record: EventResponse = {
      entityType: 'Event',
      id,
      title: input.title,
      capacity: input.capacity,
      bookedCount: 0,
      startDate: input.startDate,
      endDate: input.endDate,
      basePriceMinor: input.basePriceMinor,
      currency: input.currency,
      createdAt: new Date().toISOString(),
      attributes,
    };

    await this.repo.put(entitySk('Event', id), record);
    return record;
  }

  async get(id: string): Promise<EventResponse> {
    const found = await this.repo.get<EventRecord>(entitySk('Event', id));
    if (!found) throw new ProblemException('not-found', 404, 'Event not found');
    return toResponse(found);
  }

  async list(limit: number, cursor: string | null): Promise<Page<EventResponse>> {
    const page = await this.repo.queryPrefix<EventRecord>(skPrefix('Event'), { limit, cursor });
    return { items: page.items.map(toResponse), nextCursor: page.nextCursor };
  }
}
