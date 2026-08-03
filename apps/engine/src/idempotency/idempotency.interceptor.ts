import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, catchError, from, of, switchMap, throwError } from 'rxjs';
import { IdempotencyService } from './idempotency.service';
import { currentPrincipal, runWithTenant } from '../common/tenant-context';

/**
 * Marks a response as a replay of a previously completed request rather than
 * a freshly created result. See the design note in idempotency.service.ts /
 * the task report for why the HTTP status itself is not overridden here.
 */
export const IDEMPOTENT_REPLAY_HEADER = 'Idempotent-Replayed';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly idempotency: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const req = httpContext.getRequest<Request>();
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length === 0) return next.handle();

    // Capture the tenant principal now, synchronously, while this call is still running inside
    // the AsyncLocalStorage context TenantContextInterceptor bound around next.handle() (see
    // that class's doc comment). Every callback below (switchMap/catchError) runs later, after
    // a Redis round trip resolves its promise -- and that hop does not reliably carry the
    // AsyncLocalStorage context with it through Nest's own interceptor-chaining machinery. In
    // particular, `next.handle()` -- the actual route handler, e.g. a tenant-scoped DynamoDB
    // write -- must be invoked synchronously from inside a live tenant context for Nest to bind
    // it correctly, exactly as TenantContextInterceptor itself does. So each deferred callback
    // below re-enters the context explicitly via runWithTenant before doing anything that needs
    // it (calling next.handle(), or this service's own currentTenantId()-dependent Redis calls).
    const principal = currentPrincipal();

    return from(this.idempotency.begin(key)).pipe(
      switchMap((result) =>
        runWithTenant(principal, () => {
          if (result.status === 'replay') {
            // Nest sets the response status before the interceptor chain runs
            // at all (RouterExecutionContext.setStatus, ahead of invoking any
            // interceptor), from a value it resolved statically per route (via
            // @HttpCode or the POST-defaults-to-201 rule) — the same value on
            // every request to that route. Whatever this interceptor emits
            // never changes it, and RouterResponseController.apply()'s own
            // status argument is undefined by the time it runs here, so it
            // re-applies nothing. Net effect: a replay already receives the
            // same status code the original request did, with nothing for us
            // to override. A header still lets a caller distinguish
            // "already existed" from "just created" without relying on
            // status-code inference.
            httpContext.getResponse<Response>().setHeader(IDEMPOTENT_REPLAY_HEADER, 'true');
            return of(result.response);
          }

          return next.handle().pipe(
            // Persist the response before it reaches the client: a fire-and-forget
            // write here would let the client see success while the idempotency
            // record was still unwritten, so a crash in that gap would leave the
            // key claimed (IN_PROGRESS) until TTL expiry with no way to replay
            // the answer the client already received.
            //
            // The catchError here is scoped to `complete()` only, not to the
            // handler. If `complete()` itself fails (e.g. Redis blip) after the
            // handler already succeeded and committed its effects (order
            // created, stock decremented, ...), we must NOT treat that as a
            // request failure: doing so would release the claim below and let
            // a client retry re-run the handler, producing a second order and
            // a second stock decrement -- exactly the double-execution this
            // module exists to prevent. So on a `complete()` failure we log it
            // and still hand the client its earned successful response,
            // deliberately leaving the claim in its IN_PROGRESS state. A retry
            // during the remainder of the TTL then sees `request-in-progress`
            // (409) instead of replaying -- a transiently wrong but safe
            // answer, unlike a duplicate order, which is permanently wrong.
            // Do not "simplify" this by merging it into the catchError below.
            switchMap((response) =>
              runWithTenant(principal, () =>
                from(this.idempotency.complete(key, response)).pipe(
                  switchMap(() => of(response)),
                  catchError((completeErr: unknown) => {
                    this.logger.error({
                      msg: 'idempotency: failed to persist completed response; claim left in place until TTL expiry',
                      key,
                      err: completeErr,
                    });
                    return of(response);
                  }),
                ),
              ),
            ),
            catchError((err: unknown) =>
              runWithTenant(principal, () =>
                // Only a handler failure reaches here: complete() failures are
                // caught and swallowed above, never rethrown into this operator.
                // Release the claim so a corrected retry is not blocked by a
                // stale in-progress claim.
                from(this.idempotency.release(key)).pipe(switchMap(() => throwError(() => err))),
              ),
            ),
          );
        }),
      ),
    );
  }
}
