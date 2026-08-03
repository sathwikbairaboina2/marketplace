import { HttpException } from '@nestjs/common';

/**
 * The Engine has its own copy of this shape with its own type union. They are
 * deliberately separate: the unions name different failures, and this service
 * must render the same body over two transports — HTTP responses and socket
 * `error` events — which is what `problemBody` below exists for.
 */
export type AgentProblemType =
  | 'unauthorized'
  | 'thread-not-found'
  | 'draft-attempts-exhausted'
  | 'llm-unavailable'
  | 'engine-unavailable'
  | 'dispatch-failed'
  | 'invalid-event-payload'
  | 'invalid-request'
  | 'not-found'
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
    type: AgentProblemType,
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
