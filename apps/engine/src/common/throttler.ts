import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';
import { Request } from 'express';
import { ProblemException } from './problem';

/**
 * Rate limiting, in the shape the rest of this API answers in.
 *
 * Two departures from the stock guard:
 *
 * The refusal is a problem document. Every other error this service produces is
 * RFC 9457, and a client that parses `type`/`title`/`status` should not have to
 * special-case one route's worth of plain text because it happened to be
 * produced by middleware.
 *
 * Liveness is exempt. An orchestrator polls `/health/live` every few seconds
 * and would eventually be told 429 by an engine that is perfectly well -- which
 * is how a rate limiter turns a busy service into a restarted one.
 */
@Injectable()
export class ProblemThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    return req.path.endsWith('/health/live') || req.path.endsWith('/health/ready');
  }

  protected async throwThrottlingException(): Promise<void> {
    throw new ProblemException(
      'too-many-requests',
      429,
      'Too many requests',
      'slow down and try again shortly',
    );
  }
}

export { ThrottlerException };
