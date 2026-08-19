export type KeyedEntityType = 'Product' | 'Order' | 'Event' | 'Booking' | 'Flow' | 'Message';

export const SK_PREFIX: Record<KeyedEntityType, string> = {
  Product: 'PRODUCT#',
  Order: 'ORDER#',
  Event: 'EVENT#',
  Booking: 'BOOKING#',
  Flow: 'FLOW#',
  Message: 'MESSAGE#',
};

export function tenantPk(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

export function skPrefix(type: KeyedEntityType): string {
  return SK_PREFIX[type];
}

export function entitySk(type: KeyedEntityType, id: string): string {
  return `${SK_PREFIX[type]}${id}`;
}

export function schemaSk(entityType: string): string {
  return `SCHEMA#${entityType}`;
}

/** Tenant-level settings records: one item per named setting. */
export function settingsSk(name: string): string {
  return `SETTINGS#${name}`;
}

/** The tenant's order-stage pipeline. One record per tenant. */
export const PIPELINE_SK = settingsSk('pipeline');

/**
 * Messages sort under their order, and ULID ids sort chronologically, so one
 * `begins_with` query returns a whole order's conversation in order.
 */
export function messageSk(orderId: string, id: string): string {
  return `${SK_PREFIX.Message}${orderId}#${id}`;
}

export function messagePrefix(orderId: string): string {
  return `${SK_PREFIX.Message}${orderId}#`;
}

export function gsi1UserPk(tenantId: string, userId: string): string {
  return `TENANT#${tenantId}#USER#${userId}`;
}

export function gsi1UserSk(type: 'Order' | 'Booking', createdAt: string, id: string): string {
  return `${SK_PREFIX[type]}${createdAt}#${id}`;
}

export function normalizeTenantId(raw: string): string {
  return raw.startsWith('TENANT#') ? raw.slice('TENANT#'.length) : raw;
}
