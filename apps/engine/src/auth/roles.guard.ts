import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ProblemException } from '../common/problem';
import { ROLES } from './roles.decorator';
import { getTenantPrincipal } from './request-principal';

/**
 * Enforces `@Roles(...)`.
 *
 * Tenant isolation was enforced on every route and role on exactly one, so any
 * authenticated token -- a buyer's, or one minted before `custom:role` existed
 * and carrying no role at all -- could create products, create events, and
 * execute a schema flow that permanently alters the tenant's data model.
 *
 * Registered after JwtAuthGuard, which is what puts the principal on the
 * request. A route with no metadata is unrestricted by design: reads, and the
 * writes a buyer is *for*, declare nothing.
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

    // 403, not 401: the token is valid and the tenant is known: what is missing
    // is permission, and telling a client to re-authenticate would send it
    // round a loop that cannot end well.
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
