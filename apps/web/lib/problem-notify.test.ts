import { describe, expect, it } from 'vitest';
import { ProblemError } from './api/http';
import { toFormErrors } from './problem-notify';

/**
 * Copied verbatim from a live `POST /api/v1/events` rejection. The key is
 * `field`, not `path` -- `ZodValidationPipe` builds each entry as
 * `{ field: issue.path.join('.'), message }`. Reading the wrong key here
 * fails silently: every validation error falls through to a toast instead of
 * landing on the form field, and nothing errors to say so.
 */
const LIVE_400 = {
  errors: [{ field: 'endDate', message: 'endDate must be after startDate' }],
  type: 'https://marketplace.local/problems/invalid-request',
  title: 'Request body is invalid',
  status: 400,
  instance: '/api/v1/events',
  traceId: '6a02c12d-289c-4965-a852-f931f9bcc3fb',
};

const problemFrom = (body: typeof LIVE_400) =>
  new ProblemError(body.type, body.status, body.title, undefined, body.traceId, body.errors);

describe('toFormErrors', () => {
  it('maps a live validation problem onto the named form field', () => {
    expect(toFormErrors(problemFrom(LIVE_400))).toEqual([
      { name: 'endDate', errors: ['endDate must be after startDate'] },
    ]);
  });

  it('maps a nested field path as the dotted name the pipe produced', () => {
    const err = new ProblemError('t', 400, 'Invalid', undefined, undefined, [
      { field: 'items.0.quantity', message: 'Expected number' },
    ]);
    expect(toFormErrors(err)).toEqual([
      { name: 'items.0.quantity', errors: ['Expected number'] },
    ]);
  });

  it('returns nothing for a problem with no errors array', () => {
    expect(toFormErrors(new ProblemError('t', 500, 'Boom', undefined, undefined, []))).toEqual([]);
  });

  it('returns nothing for an error that is not a ProblemError', () => {
    expect(toFormErrors(new Error('plain'))).toEqual([]);
  });

  it('skips entries with a blank or missing field', () => {
    const err = new ProblemError('t', 400, 'Invalid', undefined, undefined, [
      { field: '', message: 'whole body' },
      { field: 'name', message: 'Required' },
    ]);
    expect(toFormErrors(err)).toEqual([{ name: 'name', errors: ['Required'] }]);
  });
});
