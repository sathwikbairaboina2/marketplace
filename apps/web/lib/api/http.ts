import { z } from 'zod';
import { ENGINE_URL } from '../env';
import { getToken } from '../auth/auth-context';

/**
 * One entry of the `errors[]` array `ZodValidationPipe` attaches to a 400.
 * The key is `field`, not `path` -- see apps/engine/src/common/zod-validation.pipe.ts,
 * which builds it as `{ field: issue.path.join('.'), message }`.
 */
export interface ProblemField {
  field: string;
  message: string;
}

/**
 * An RFC 9457 problem document, as written by both services' ProblemFilter.
 * `type`, `title` and `status` are required by the spec; `instance` and
 * `traceId` are added to every response the filter writes, and
 * `ZodValidationPipe` attaches `errors[]` on a 400.
 */
export class ProblemError extends Error {
  constructor(
    readonly type: string,
    readonly status: number,
    readonly title: string,
    readonly detail: string | undefined,
    readonly traceId: string | undefined,
    readonly errors: ProblemField[],
  ) {
    super(detail ? `${title}: ${detail}` : title);
    this.name = 'ProblemError';
  }
}

/**
 * The request succeeded but the body failed its schema. Not a user error: it
 * means this client and the service disagree about @marketplace/contracts, so
 * it is surfaced persistently rather than as a toast that vanishes.
 */
export class ContractMismatchError extends Error {
  constructor(
    readonly path: string,
    readonly issues: z.ZodIssue[],
  ) {
    super(`Response from ${path} did not match its contract`);
    this.name = 'ContractMismatchError';
  }
}

let unauthorizedHandler: () => void = () => {};

/** Registered by the app shell so a 401 anywhere lands on /login. */
export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

export interface RequestOptions<S extends z.ZodTypeAny> {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  schema: S;
  idempotencyKey?: string;
}

/**
 * Generic over the schema rather than over a result type, and returning
 * `z.output<S>` explicitly.
 *
 * With a `z.ZodType<T>` parameter, TypeScript is free to bind `T` to either the
 * schema's input or its output type, and it picks differently at different call
 * sites. Any schema with a `.default()` -- `AddedFieldSchema.required` is one --
 * has an input where that key is optional and an output where it is required,
 * so the two bindings are not interchangeable and the mismatch surfaces as an
 * unreadable assignability error far from its cause. Parsing always yields the
 * output type, so that is what this promises.
 */
export async function request<S extends z.ZodTypeAny>(
  path: string,
  opts: RequestOptions<S>,
): Promise<z.output<S>> {
  const url = new URL(`${ENGINE_URL}${path}`);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (opts.body !== undefined) headers.set('Content-Type', 'application/json');
  if (opts.idempotencyKey) headers.set('Idempotency-Key', opts.idempotencyKey);

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  if (!res.ok) {
    if (res.status === 401) unauthorizedHandler();
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ProblemError(
      typeof body.type === 'string' ? body.type : 'about:blank',
      res.status,
      typeof body.title === 'string' ? body.title : res.statusText,
      typeof body.detail === 'string' ? body.detail : undefined,
      typeof body.traceId === 'string' ? body.traceId : undefined,
      Array.isArray(body.errors) ? (body.errors as ProblemField[]) : [],
    );
  }

  const parsed = opts.schema.safeParse(await res.json());
  if (!parsed.success) throw new ContractMismatchError(path, parsed.error.issues);
  return parsed.data;
}
