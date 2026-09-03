import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { TENANT_ID_PATTERN } from '@marketplace/auth';
import { ENV, EnvConfig } from '../config/env.schema';
import { ProblemException } from '../common/problem';
import { setTenantPrincipal } from '../auth/request-principal';
import { guestUserId, verifyGuest } from './guest-token';

/**
 * Turns a genuine X-Guest ticket into a principal for the shop in the path.
 * Applied per route beside @Public(): the global JwtAuthGuard lets the public
 * route through, this guard then says who the stranger is, and
 * TenantContextInterceptor binds it exactly as it binds a JWT's principal.
 * A bad or missing ticket is a 401, never a 404 -- there is nothing to hide.
 */
@Injectable()
export class GuestGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: EnvConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    // Express types a param as string | string[]; a path param is one string.
    const raw = req.params.tenantId;
    const tenantId = Array.isArray(raw) ? raw[0] : raw;
    if (!tenantId || !TENANT_ID_PATTERN.test(tenantId)) {
      throw new ProblemException('not-found', 404, 'No such shop');
    }
    const header = req.headers['x-guest'];
    const id = verifyGuest(this.env.GUEST_SECRET, tenantId, Array.isArray(header) ? header[0] : header);
    if (!id) {
      throw new ProblemException('invalid-guest', 401, 'Guest ticket missing or not for this shop');
    }
    setTenantPrincipal(req, { tenantId, userId: guestUserId(id), role: 'guest' });
    return true;
  }
}
