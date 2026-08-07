import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMoney, formatRelative } from './format';

describe('formatDateTime', () => {
  // The whole point: `2026-09-15T09:00:00.000Z` was being rendered verbatim to
  // users on event, order, booking and flow pages.
  it('renders a readable date and time, not an ISO string', () => {
    const out = formatDateTime('2026-09-15T09:00:00.000Z');
    expect(out).not.toContain('T');
    expect(out).not.toContain('Z');
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/Sep/i);
  });

  it('leaves an unparseable value alone rather than printing Invalid Date', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
    expect(formatDateTime('')).toBe('—');
    expect(formatDateTime(null)).toBe('—');
  });
});

describe('formatDate', () => {
  it('drops the time when only the day matters', () => {
    const out = formatDate('2026-09-15T09:00:00.000Z');
    expect(out).toMatch(/2026/);
    expect(out).not.toMatch(/\d\d:\d\d/);
  });
});

describe('formatMoney', () => {
  it('renders minor units as an amount with two decimals', () => {
    expect(formatMoney(89900)).toBe('899.00');
    expect(formatMoney(0)).toBe('0.00');
    expect(formatMoney(5)).toBe('0.05');
  });

  it('groups thousands so long prices stay readable', () => {
    expect(formatMoney(124990000)).toBe('1,249,900.00');
  });
});

describe('formatRelative', () => {
  it('describes recent instants in words', () => {
    const now = Date.parse('2026-09-15T12:00:00.000Z');
    expect(formatRelative('2026-09-15T11:59:30.000Z', now)).toBe('just now');
    expect(formatRelative('2026-09-15T11:45:00.000Z', now)).toBe('15 minutes ago');
    expect(formatRelative('2026-09-15T09:00:00.000Z', now)).toBe('3 hours ago');
    expect(formatRelative('2026-09-13T12:00:00.000Z', now)).toBe('2 days ago');
  });

  it('falls back to an absolute date once relative stops being useful', () => {
    const now = Date.parse('2026-09-15T12:00:00.000Z');
    expect(formatRelative('2026-01-02T12:00:00.000Z', now)).toMatch(/2026/);
  });

  it('handles the singular', () => {
    const now = Date.parse('2026-09-15T12:00:00.000Z');
    expect(formatRelative('2026-09-15T11:00:00.000Z', now)).toBe('1 hour ago');
    expect(formatRelative('2026-09-14T12:00:00.000Z', now)).toBe('1 day ago');
  });
});
