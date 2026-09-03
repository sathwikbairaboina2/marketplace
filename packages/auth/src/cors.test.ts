import { originAllowed, parseCorsOrigins } from './cors';

describe('originAllowed', () => {
  const patterns = ['http://localhost:3002', 'http://127.0.0.1:3002', 'http://*.localhost:3002'];

  it('allows an exact entry', () => {
    expect(originAllowed('http://localhost:3002', patterns)).toBe(true);
    expect(originAllowed('http://127.0.0.1:3002', patterns)).toBe(true);
  });

  it('allows one label under a wildcard entry', () => {
    expect(originAllowed('http://acme.localhost:3002', patterns)).toBe(true);
    expect(originAllowed('http://jt-abc-a.localhost:3002', patterns)).toBe(true);
  });

  it('refuses two labels, another scheme, another port and another host', () => {
    expect(originAllowed('http://a.b.localhost:3002', patterns)).toBe(false);
    expect(originAllowed('https://acme.localhost:3002', patterns)).toBe(false);
    expect(originAllowed('http://acme.localhost:3000', patterns)).toBe(false);
    expect(originAllowed('http://acme.localhost.evil:3002', patterns)).toBe(false);
    expect(originAllowed('http://evil.example:3002', patterns)).toBe(false);
  });

  it('refuses an empty label and a missing origin', () => {
    expect(originAllowed('http://.localhost:3002', patterns)).toBe(false);
    expect(originAllowed(undefined, patterns)).toBe(false);
  });

  it('never lets a wildcard match the bare host it hangs off', () => {
    expect(originAllowed('http://localhost:3002', ['http://*.localhost:3002'])).toBe(false);
  });

  it('parses a comma list and drops blanks', () => {
    expect(parseCorsOrigins(' http://a , ,http://*.b ')).toEqual(['http://a', 'http://*.b']);
  });
});
