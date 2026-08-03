import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, catchError, from, of, switchMap, throwError } from 'rxjs';
import { IdempotencyService } from './idempotency.service';

/**
 * Marks a response as a replay of a previously completed request rather than
 * a freshly created result. See the design note in idempotency.service.ts /
 * the task report for why the HTTP status itself is not overridden here.
 */
export const IDEMPOTENT_REPLAY_HEADER = 'Idempotent-Replayed';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotency: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const req = httpContext.getRequest<Request>();
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length === 0) return next.handle();

    return from(this.idempotency.begin(key)).pipe(
      switchMap((result) => {
        if (result.status === 'replay') {
          // Nest binds a route's HTTP status statically (via @HttpCode or the
          // POST-defaults-to-201 rule) and reapplies it to every response
          // through that route regardless of what value the interceptor
          // returns, so a replay handled this way already receives the same
          // status code the original request did — nothing to override here.
          // A header still lets a caller distinguish "already existed" from
          // "just created" without relying on status-code inference.
          httpContext.getResponse<Response>().setHeader(IDEMPOTENT_REPLAY_HEADER, 'true');
          return of(result.response);
        }

        return next.handle().pipe(
          // Persist the response before it reaches the client: a fire-and-forget
          // write here would let the client see success while the idempotency
          // record was still unwritten, so a crash in that gap would leave the
          // key claimed (IN_PROGRESS) until TTL expiry with no way to replay
          // the answer the client already received.
          switchMap((response) => from(this.idempotency.complete(key, response)).pipe(switchMap(() => of(response)))),
          catchError((err: unknown) =>
            // Release the claim before letting the error propagate so a
            // corrected retry is not blocked by a stale in-progress claim.
            from(this.idempotency.release(key)).pipe(switchMap(() => throwError(() => err))),
          ),
        );
      }),
    );
  }
}
