import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthError } from '@marketplace/auth';
import { IS_PUBLIC } from './public.decorator';
import { JwtVerifierService } from './jwt-verifier.service';
import { setTenantPrincipal } from './request-principal';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly verifier: JwtVerifierService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // The gateway authenticates at the handshake, not per event, so socket
    // contexts never reach this guard.
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('missing bearer token');

    let principal;
    try {
      principal = await this.verifier.verify(header.slice('Bearer '.length));
    } catch (err) {
      // @marketplace/auth is framework-free; the HTTP transport maps its
      // failure to 401 here, exactly as the socket gateway maps it to a
      // problem document and a disconnect.
      if (err instanceof AuthError) throw new UnauthorizedException(err.message);
      throw err;
    }

    // Stash on the request rather than binding the async context here.
    // Nest's guards consumer (@nestjs/core/guards/guards-consumer.js) awaits
    // this method's promise from a continuation that was already scheduled
    // before verify() resolved; an AsyncLocalStorage.enterWith() call made
    // after that `await` never becomes visible to that continuation, so it
    // would not reach the controller. TenantContextInterceptor binds the
    // context instead, in a place where Nest's pipeline actually preserves it
    // (AsyncResource.bind, applied at the point next.handle() is called).
    setTenantPrincipal(req, principal);
    return true;
  }
}
