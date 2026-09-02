import { describe, expect, it } from 'vitest';
import { shopFromHost } from './shop-host';

describe('shopFromHost', () => {
  const platform = 'localhost:3002';

  it('reads one label in front of the platform host', () => {
    expect(shopFromHost('acme.localhost:3002', platform)).toBe('acme');
    expect(shopFromHost('jt-k3x-a.localhost:3002', platform)).toBe('jt-k3x-a');
  });

  it('is null on the bare platform host', () => {
    expect(shopFromHost('localhost:3002', platform)).toBeNull();
    expect(shopFromHost('127.0.0.1:3002', platform)).toBeNull();
  });

  it('is null for two labels, a foreign host and a reserved label', () => {
    expect(shopFromHost('a.b.localhost:3002', platform)).toBeNull();
    expect(shopFromHost('acme.localhost:3000', platform)).toBeNull();
    expect(shopFromHost('acme.example.com', platform)).toBeNull();
    for (const reserved of ['admin', 'www', 'api']) {
      expect(shopFromHost(`${reserved}.localhost:3002`, platform)).toBeNull();
    }
  });

  it('compares hosts case-insensitively and keeps the tenant id as typed', () => {
    expect(shopFromHost('Acme.LOCALHOST:3002', platform)).toBe('Acme');
  });

  it('works for a real platform domain', () => {
    expect(shopFromHost('kiln.shops.example', 'shops.example')).toBe('kiln');
    expect(shopFromHost('shops.example', 'shops.example')).toBeNull();
  });
});
