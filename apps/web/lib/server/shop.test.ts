import { describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({ PLATFORM_HOST: 'localhost:33002' }));
import { requestShopFrom } from './shop';

describe('requestShopFrom', () => {
  it('names the shop from the Host header and writes URLs against it', () => {
    expect(requestShopFrom('acme.localhost:33002', null)).toEqual({
      tenantId: 'acme',
      origin: 'http://acme.localhost:33002',
    });
  });

  it('is nobody on the platform host', () => {
    expect(requestShopFrom('localhost:33002', null).tenantId).toBeNull();
  });

  it('keeps https when a proxy says so, and never invents it', () => {
    expect(requestShopFrom('acme.localhost:33002', 'https').origin).toBe('https://acme.localhost:33002');
    expect(requestShopFrom('acme.localhost:33002', 'http').origin).toBe('http://acme.localhost:33002');
  });

  it('falls back to the platform host when the header is missing', () => {
    expect(requestShopFrom(null, null)).toEqual({ tenantId: null, origin: 'http://localhost:33002' });
  });
});
