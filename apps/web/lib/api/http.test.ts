import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { request, ProblemError, ContractMismatchError, onUnauthorized } from './http';

const Schema = z.object({ id: z.string() }).strict();

const jsonResponse = (body: unknown, status = 200, contentType = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });

describe('request', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    onUnauthorized(() => {});
  });

  it('returns the parsed body on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ id: 'a' })));
    await expect(request('/things/a', { schema: Schema })).resolves.toEqual({ id: 'a' });
  });

  it('sends the idempotency key only when given one', async () => {
    // Parameters are declared so `mock.calls` is typed as the fetch signature;
    // an argument-less `vi.fn` infers empty tuples and every `calls[0][1]` below
    // becomes a type error.
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ id: 'a' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await request('/things', { method: 'POST', body: {}, schema: Schema, idempotencyKey: 'k-1' });
    const first = new Headers(fetchMock.mock.calls[0]![1]!.headers as HeadersInit);
    expect(first.get('Idempotency-Key')).toBe('k-1');

    await request('/things', { method: 'POST', body: {}, schema: Schema });
    const second = new Headers(fetchMock.mock.calls[1]![1]!.headers as HeadersInit);
    expect(second.has('Idempotency-Key')).toBe(false);
  });

  it('throws ProblemError carrying the traceId and errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            type: 'validation-failed',
            title: 'Invalid request',
            status: 400,
            detail: 'name is required',
            traceId: 'trace-9',
            errors: [{ path: 'name', message: 'Required' }],
          },
          400,
          'application/problem+json',
        ),
      ),
    );

    const err = (await request('/things', { schema: Schema }).catch((e: unknown) => e)) as
      ProblemError;
    expect(err).toBeInstanceOf(ProblemError);
    expect(err.status).toBe(400);
    expect(err.traceId).toBe('trace-9');
    expect(err.errors).toHaveLength(1);
  });

  it('throws ContractMismatchError when the body does not match the schema', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ wrong: true })));
    await expect(request('/things/a', { schema: Schema })).rejects.toBeInstanceOf(
      ContractMismatchError,
    );
  });

  it('notifies the unauthorized handler on a 401', async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { type: 'unauthorized', title: 'Unauthorized', status: 401 },
          401,
          'application/problem+json',
        ),
      ),
    );

    await request('/things/a', { schema: Schema }).catch(() => {});
    expect(handler).toHaveBeenCalledOnce();
  });

  it('serialises query parameters and drops undefined ones', async () => {
    // Parameters are declared so `mock.calls` is typed as the fetch signature;
    // an argument-less `vi.fn` infers empty tuples and every `calls[0][1]` below
    // becomes a type error.
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ id: 'a' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await request('/things', { query: { limit: 25, cursor: undefined }, schema: Schema });
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/things\?limit=25$/);
  });

  it('sends no Authorization header when there is no token', async () => {
    // Parameters are declared so `mock.calls` is typed as the fetch signature;
    // an argument-less `vi.fn` infers empty tuples and every `calls[0][1]` below
    // becomes a type error.
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ id: 'a' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await request('/things/a', { schema: Schema });
    const headers = new Headers(fetchMock.mock.calls[0]![1]!.headers as HeadersInit);
    expect(headers.has('Authorization')).toBe(false);
  });

  it('falls back to the status text when the error body is not a problem document', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway blew up', { status: 502 })));
    const err = (await request('/things/a', { schema: Schema }).catch((e: unknown) => e)) as
      ProblemError;
    expect(err).toBeInstanceOf(ProblemError);
    expect(err.status).toBe(502);
    expect(err.type).toBe('about:blank');
    expect(err.errors).toEqual([]);
  });
});
