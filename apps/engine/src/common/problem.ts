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
  // A second admin saved the shop's order stages while this one was editing.
  | 'pipeline-version-conflict'
  // The order left the stage the caller was looking at before their change landed.
  | 'stage-moved'
  | 'order-at-final-stage'
  | 'order-not-advanceable'
  | 'order-not-cancellable'
  | 'stage-not-messageable'
  | 'order-not-messageable'
  | 'transaction-conflict'
  | 'request-in-progress'
  // Upload rejected on inspection: either the declared type is not accepted, or
  // the file's own bytes disagree with what was declared.
  | 'unsupported-media-type'
  | 'payload-too-large'
  | 'too-many-requests'
  | 'unauthorized'
  | 'forbidden'
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
