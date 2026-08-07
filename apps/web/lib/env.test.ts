import { describe, expect, it } from 'vitest';
import { ENGINE_URL, AGENTS_URL } from './env';

describe('env', () => {
  it('exposes absolute base URLs with no trailing slash', () => {
    for (const url of [ENGINE_URL, AGENTS_URL]) {
      expect(url).toMatch(/^https?:\/\//);
      expect(url.endsWith('/')).toBe(false);
    }
  });

  // These are read in the browser, so a compose service name would be
  // unresolvable. Guard against someone "fixing" the default to `engine:3000`.
  it('defaults to host-facing origins, not compose service names', () => {
    expect(ENGINE_URL).toContain('localhost');
    expect(AGENTS_URL).toContain('localhost');
  });
});
