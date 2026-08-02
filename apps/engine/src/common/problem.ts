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
  }
}
