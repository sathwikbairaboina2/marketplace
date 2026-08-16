/**
 * Presentation helpers for values that arrive from the API in machine form.
 *
 * The engine speaks ISO 8601 and minor currency units, which is right for a
 * wire format and wrong for a person: event, order, booking and flow pages were
 * rendering `2026-09-15T09:00:00.000Z` verbatim.
 */

const EM_DASH = '—';

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** `15 Sep 2026, 09:00`. Falls back to the input rather than "Invalid Date". */
export function formatDateTime(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return EM_DASH;
  const date = parse(value);
  if (!date) return value;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** `15 Sep 2026` -- for when the time of day carries no meaning. */
export function formatDate(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return EM_DASH;
  const date = parse(value);
  if (!date) return value;
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * How many minor units make one of a currency, and how many decimals it shows.
 *
 * "Minor" is not always a hundredth. A yen has no subunit, so ¥3,400 arrives
 * from the engine as `3400` and dividing by 100 rendered it as 34.00 -- out by
 * a factor of a hundred, in the direction that makes a shop look cheap. A
 * Bahraini dinar goes the other way, at a thousand fils.
 *
 * Asked of Intl rather than hard-coded: the browser already ships the table,
 * and a list maintained here would drift from it. An unknown code falls back
 * to two decimals, which is what the overwhelming majority of currencies use
 * and what this function did for every currency before.
 */
function fractionDigitsFor(currency?: string): number {
  if (!currency) return 2;
  try {
    const resolved = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).resolvedOptions();
    return resolved.maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * Minor units to a grouped decimal string: `124990000` -> `1,249,900.00`.
 *
 * Grouping matters more than it looks -- an unseparated eight-digit price is
 * genuinely hard to read at a glance.
 *
 * `currency` is optional so every existing caller keeps its behaviour, but
 * passing it is what makes a zero-decimal currency come out right.
 */
export function formatMoney(minor: number, currency?: string): string {
  const digits = fractionDigitsFor(currency);
  return (minor / 10 ** digits).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "3 hours ago" while that is more informative than a date, and an absolute
 * date once it is not. `now` is injectable so this is testable without
 * freezing the clock.
 */
export function formatRelative(value: string | null | undefined, now = Date.now()): string {
  const date = parse(value);
  if (!date) return value ? value : EM_DASH;

  const delta = now - date.getTime();
  if (delta < 0) return formatDateTime(value);
  if (delta < MINUTE) return 'just now';

  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (delta < HOUR) return plural(Math.floor(delta / MINUTE), 'minute');
  if (delta < DAY) return plural(Math.floor(delta / HOUR), 'hour');
  if (delta < 7 * DAY) return plural(Math.floor(delta / DAY), 'day');
  return formatDate(value);
}
