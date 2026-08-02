import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC } from './public.decorator';
import { JwtVerifier } from './jwt-verifier';
import { setTenantPrincipal } from './request-principal';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly verifier: JwtVerifier,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }

    const principal = await this.verifier.verify(header.slice('Bearer '.length));

    // Stash on the request rather than binding the async context here.
    // Nest's guards consumer (@nestjs/core/guards/guards-consumer.js) awaits
    // this method's promise from a continuation that was already scheduled
    // before verify() resolved; an AsyncLocalStorage.enterWith() call made
    // after that `await` never becomes visible to that continuation, so it
    // would not reach the controller. TenantContextInterceptor binds the
    // context instead, in a place where Nest's pipeline actually preserves
    // it (AsyncResource.bind, applied at the point next.handle() is called).
    setTenantPrincipal(req, principal);
    return true;
  }
}
