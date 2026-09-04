import {
  pageOf,
  ProductResponseSchema,
  EventResponseSchema,
  OrderResponseSchema,
  BookingResponseSchema,
  FlowResponseSchema,
  PrincipalSchema,
  SchemaViewSchema,
  SchemaListSchema,
} from './responses';

const product = {
  entityType: 'Product' as const,
  id: '01J0000000000000000000000A',
  status: 'active' as const,
  name: 'Widget',
  description: 'A widget',
  priceMinor: 1500,
  currency: 'USD',
  category: 'tools',
  stock: 10,
  images: [],
  pinned: false,
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z',
  attributes: { colour: 'red' },
};

const order = {
  entityType: 'Order' as const,
  id: '01J0000000000000000000000D',
  reference: '0000-000D',
  userId: 'u1',
  status: 'confirmed' as const,
  totalAmountMinor: 3000,
  currency: 'USD',
  items: [{ productId: product.id, quantity: 2, unitPriceMinor: 1500 }],
  shippingAddress: { line1: '1 Test Street' },
  createdAt: '2026-08-07T00:00:00.000Z',
  attributes: {},
  pipelineVersion: 0,
  stages: [
    { id: '00000000000000000000000000', name: 'Confirmed', cancellable: true, messaging: false },
  ],
  currentStageId: '00000000000000000000000000',
  stageEnteredAt: '2026-08-07T00:00:00.000Z',
};

describe('response schemas', () => {
  it('accepts a product response and rejects one missing priceMinor', () => {
    expect(ProductResponseSchema.parse(product)).toMatchObject({ name: 'Widget' });
    const { priceMinor, ...withoutPrice } = product;
    expect(ProductResponseSchema.safeParse(withoutPrice).success).toBe(false);
  });

  it('rejects a product response carrying the DynamoDB keys', () => {
    expect(ProductResponseSchema.safeParse({ ...product, PK: 'TENANT#a' }).success).toBe(false);
  });

  it('wraps items and a nullable cursor', () => {
    const page = pageOf(ProductResponseSchema);
    expect(page.parse({ items: [product], nextCursor: null }).items).toHaveLength(1);
    expect(page.safeParse({ items: [product] }).success).toBe(false);
  });

  // EventRecord carries `bookedCount`, not `booked`, and has no `updatedAt` --
  // unlike ProductRecord. The two are not symmetrical and the schema must not
  // pretend they are.
  it('accepts an event response with bookedCount and no updatedAt', () => {
    const event = {
      entityType: 'Event' as const,
      id: '01J0000000000000000000000C',
      images: [],
      title: 'Launch',
      capacity: 100,
      bookedCount: 4,
      startDate: '2026-09-01T10:00:00.000Z',
      endDate: '2026-09-01T18:00:00.000Z',
      basePriceMinor: 2500,
      currency: 'USD',
      createdAt: '2026-08-07T00:00:00.000Z',
      attributes: {},
    };
    expect(EventResponseSchema.parse(event).bookedCount).toBe(4);
    expect(EventResponseSchema.safeParse({ ...event, updatedAt: event.createdAt }).success).toBe(
      false,
    );
  });

  it('accepts an order response with its line items', () => {
    expect(OrderResponseSchema.parse(order).items).toHaveLength(1);
  });

  // The snapshot is required on the response even though it is absent from
  // orders written before stages existed: OrdersService fills it on read, so
  // the wire shape stays single and the table needs no backfill.
  it('requires the stage snapshot on an order response', () => {
    const { stages, ...withoutStages } = order;
    expect(OrderResponseSchema.safeParse(withoutStages).success).toBe(false);
  });

  it('accepts an order carrying a multi-stage snapshot', () => {
    const parsed = OrderResponseSchema.parse({
      ...order,
      pipelineVersion: 3,
      stages: [
        { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', name: 'Cut', cancellable: true, messaging: true },
        { id: '01ARZ3NDEKTSV4RRFFQ69G5FAW', name: 'Sealed', cancellable: false, messaging: false },
      ],
      currentStageId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    });
    expect(parsed.stages).toHaveLength(2);
  });

  it('accepts a booking response', () => {
    const booking = {
      entityType: 'Booking' as const,
      id: '01J0000000000000000000000E',
      reference: '0000-000E',
      eventId: '01J0000000000000000000000C',
      userId: 'u1',
      status: 'confirmed' as const,
      ticketQuantity: 2,
      createdAt: '2026-08-07T00:00:00.000Z',
      attributes: {},
    };
    expect(BookingResponseSchema.parse(booking).ticketQuantity).toBe(2);
  });

  it('accepts a schema view and a schema list', () => {
    const view = {
      entityType: 'Product' as const,
      version: 2,
      fields: { colour: { type: 'string' as const, required: false, default: null } },
    };
    expect(SchemaViewSchema.parse(view).version).toBe(2);
    expect(SchemaListSchema.parse({ items: [view] }).items).toHaveLength(1);
  });

  // FlowResponse is Omit<FlowRecord, 'PK' | 'SK'>, so entityType survives.
  it('accepts a flow response with a null executedBy', () => {
    expect(
      FlowResponseSchema.parse({
        entityType: 'Flow',
        id: '01J0000000000000000000000B',
        targetEntity: 'Product',
        actionType: 'ADD_FIELDS',
        status: 'proposed',
        blueprintDiff: {
          addedFields: [{ name: 'colour', type: 'string', required: false, default: null }],
        },
        createdAt: '2026-08-07T00:00:00.000Z',
        proposedBy: 'user-1',
        executedBy: null,
        appliedAt: null,
        resultingVersion: null,
      }).status,
    ).toBe('proposed');
  });

  it('accepts a principal with a null role', () => {
    expect(PrincipalSchema.parse({ tenantId: 'acme', userId: 'u1', role: null }).role).toBeNull();
  });
});
