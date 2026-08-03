import { HttpException } from '@nestjs/common';

export type ProblemType =
  | 'insufficient-stock'
  | 'price-changed'
  | 'event-at-capacity'
  | 'schema-validation-failed'
  | 'unsupported-schema-change'
  | 'schema-version-conflict'
  | 'too-many-line-items'
  | 'mixed-currency-order'
  | 'transaction-conflict'
  | 'request-in-progress'
  | 'unauthorized'
  | 'not-found'
  | 'invalid-request'
  | 'internal-error';

export interface ProblemBody extends Record<string, unknown> {
  type: string;
  title: string;
  status: number;
  detail?: string;
}

export class ProblemException extends HttpException {
  readonly problem: ProblemBody;

  constructor(
    type: ProblemType,
    status: number,
    title: string,
    detail?: string,
    extra: Record<string, unknown> = {},
  ) {
    const problem: ProblemBody = {
      ...extra,
      type: `https://marketplace.local/problems/${type}`,
      title,
      status,
      ...(detail === undefined ? {} : { detail }),
    };
    super(problem, status);
    this.problem = problem;
    // HttpException.initMessage() only reads `response.message`, which the
    // RFC 9457 body deliberately omits (it uses `title`/`detail` instead) so
    // that field never leaks into the wire format. Without this, `.message`
    // falls back to a useless class-name-derived string ("Problem
    // Exception") for every instance, and anything asserting on it via
    // `.rejects.toThrow(/pattern/)` — a standard, idiomatic way to assert on
    // a thrown error's content — would fail no matter what actually went
    // wrong. This only overrides the in-process Error#message; the
    // client-facing body still comes from `this.problem` via
    // ProblemFilter, so the wire format is unaffected.
    this.message = detail ? `${title}: ${detail}` : title;
  }
}
