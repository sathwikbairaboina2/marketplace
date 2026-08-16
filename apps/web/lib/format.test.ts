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

describe('formatMoney with a currency', () => {
  // The engine stores minor units, but "minor" is not always a hundredth. A
  // yen has no subunit at all, so ¥3,400 arrives as 3400 and was being shown
  // as 34.00 -- out by a factor of a hundred, in the direction that makes a
  // shop look cheap.
  it('renders a zero-decimal currency without inventing decimals', () => {
    expect(formatMoney(3400, 'JPY')).toBe('3,400');
    expect(formatMoney(500, 'KRW')).toBe('500');
  });

  it('still renders a two-decimal currency the way it always did', () => {
    expect(formatMoney(89900, 'USD')).toBe('899.00');
    expect(formatMoney(0, 'EUR')).toBe('0.00');
  });

  it('renders a three-decimal currency with three', () => {
    expect(formatMoney(1234, 'BHD')).toBe('1.234');
  });

  it('groups thousands so a long amount stays readable', () => {
    expect(formatMoney(124990000, 'USD')).toBe('1,249,900.00');
  });

  // Every existing caller passes no currency at all; those must keep working
  // exactly as before rather than silently changing what a shop displays.
  it('assumes two decimals when no currency is given', () => {
    expect(formatMoney(89900)).toBe('899.00');
  });

  it('falls back to two decimals for a code it does not recognise', () => {
    expect(formatMoney(1000, 'XYZ')).toBe('10.00');
  });
});
