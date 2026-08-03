import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { runWithTenant } from '@marketplace/auth';
import { getTenantPrincipal } from './request-principal';

/**
 * Binds the verified principal to this request's async execution scope.
 *
 * This has to be an interceptor, not something JwtAuthGuard does directly,
 * because of how Nest's guard pipeline is wired (see the comment in
 * jwt-auth.guard.ts): AsyncLocalStorage.enterWith() called after the `await`
 * that verifies the token never reaches the controller, since Nest's guards
 * consumer awaits the guard's promise from an already-established
 * continuation that does not observe a store mutation made inside it.
 *
 * Interceptors don't have that problem: Nest's own interceptors-consumer.js
 * wraps the continuation in AsyncResource.bind() at the moment next.handle()
 * is invoked. So as long as next.handle() is called synchronously from
 * inside runWithTenant's callback (not awaited into first, not deferred into
 * a subscriber callback), the bound continuation -- and everything the
 * controller does -- correctly sees the tenant context.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const principal = getTenantPrincipal(req);
    // Public route: the guard never verified a token, so there is nothing to bind.
    if (!principal) return next.handle();
    return runWithTenant(principal, () => next.handle());
  }
}
