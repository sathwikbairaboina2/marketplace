import { entitySk, gsi1UserPk, gsi1UserSk, normalizeTenantId, schemaSk, skPrefix, tenantPk } from './keys';

describe('key builders', () => {
  it('builds a tenant partition key', () => {
    expect(tenantPk('client_123')).toBe('TENANT#client_123');
  });

  it('builds entity sort keys', () => {
    expect(entitySk('Product', '01J000000000000000000000AB')).toBe('PRODUCT#01J000000000000000000000AB');
    expect(skPrefix('Order')).toBe('ORDER#');
    expect(schemaSk('Product')).toBe('SCHEMA#Product');
  });

  it('builds the user index keys', () => {
    expect(gsi1UserPk('client_123', 'user-1')).toBe('TENANT#client_123#USER#user-1');
    expect(gsi1UserSk('Order', '2026-08-03T10:00:00.000Z', 'abc')).toBe(
      'ORDER#2026-08-03T10:00:00.000Z#abc',
    );
  });

  it('normalizes a tenant id that already carries the prefix', () => {
    expect(normalizeTenantId('TENANT#client_123')).toBe('client_123');
    expect(normalizeTenantId('client_123')).toBe('client_123');
  });
});
