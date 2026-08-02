export type KeyedEntityType = 'Product' | 'Order' | 'Event' | 'Booking' | 'Flow';

export const SK_PREFIX: Record<KeyedEntityType, string> = {
  Product: 'PRODUCT#',
  Order: 'ORDER#',
  Event: 'EVENT#',
  Booking: 'BOOKING#',
  Flow: 'FLOW#',
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

export function gsi1UserPk(tenantId: string, userId: string): string {
  return `TENANT#${tenantId}#USER#${userId}`;
}

export function gsi1UserSk(type: 'Order' | 'Booking', createdAt: string, id: string): string {
  return `${SK_PREFIX[type]}${createdAt}#${id}`;
}

export function normalizeTenantId(raw: string): string {
  return raw.startsWith('TENANT#') ? raw.slice('TENANT#'.length) : raw;
}
