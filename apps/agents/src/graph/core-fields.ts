import { DynamicEntityType } from '@marketplace/contracts';

/**
 * Core field names per entity, from the Engine's contracts (`packages/contracts/src/*.ts`
 * record interfaces). A dynamic attribute with one of these names is not technically
 * ambiguous -- attributes live in their own map -- but it is confusing enough in every
 * downstream query and report that the agent refuses to propose one.
 *
 * Order and Booking carry `GSI1PK`/`GSI1SK` alongside `PK`/`SK` (their records are looked
 * up via a secondary index); Product and Event do not.
 */
export const CORE_FIELDS: Record<DynamicEntityType, readonly string[]> = {
  Product: [
    'PK', 'SK', 'entityType', 'id', 'status', 'name', 'description', 'priceMinor',
    'currency', 'category', 'stock', 'images', 'createdAt', 'updatedAt', 'attributes',
  ],
  Order: [
    'PK', 'SK', 'GSI1PK', 'GSI1SK', 'entityType', 'id', 'userId', 'status', 'totalAmountMinor',
    'currency', 'items', 'shippingAddress', 'createdAt', 'attributes',
  ],
  Event: [
    'PK', 'SK', 'entityType', 'id', 'title', 'capacity', 'bookedCount', 'startDate',
    'endDate', 'basePriceMinor', 'currency', 'createdAt', 'attributes',
  ],
  Booking: [
    'PK', 'SK', 'GSI1PK', 'GSI1SK', 'entityType', 'id', 'eventId', 'userId', 'status',
    'ticketQuantity', 'createdAt', 'attributes',
  ],
};
