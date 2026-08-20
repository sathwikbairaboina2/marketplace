import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ProblemException } from '../common/problem';
import { ROLES } from './roles.decorator';
import { getTenantPrincipal } from './request-principal';

/**
 * Enforces `@Roles(...)` on the agents service's HTTP routes, the same shape
 * as the engine's guard. Registered after JwtAuthGuard, which is what puts
 * the principal on the request. A route with no metadata is unrestricted by
 * design.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const principal = getTenantPrincipal(req);

    // 403, not 401: the token is valid; what is missing is permission.
    if (!principal?.role || !required.includes(principal.role)) {
      throw new ProblemException(
        'forbidden',
        403,
        'Not allowed',
        `this route is restricted to: ${required.join(', ')}`,
      );
    }

    return true;
  }
}
