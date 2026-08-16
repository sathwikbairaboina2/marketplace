import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProblemException } from '../common/problem';
import { ROLES } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { setTenantPrincipal } from './request-principal';

/** A context whose handler carries whatever roles metadata the test wants. */
function contextFor(required: string[] | undefined, req: object): ExecutionContext {
  const handler = () => undefined;
  if (required) Reflect.defineMetadata(ROLES, required, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const guard = new RolesGuard(new Reflector());

const requestAs = (role: string | null) => {
  const req = {};
  setTenantPrincipal(req, { tenantId: 'acme', userId: 'u1', role });
  return req;
};

describe('RolesGuard', () => {
  it('lets a route with no declared roles through', () => {
    expect(guard.canActivate(contextFor(undefined, requestAs('buyer')))).toBe(true);
  });

  it('lets the declared role through', () => {
    expect(guard.canActivate(contextFor(['admin'], requestAs('admin')))).toBe(true);
  });

  it('refuses a role that was not declared', () => {
    expect(() => guard.canActivate(contextFor(['admin'], requestAs('buyer')))).toThrow(
      ProblemException,
    );
  });

  // A token minted before `custom:role` existed carries no role at all. It must
  // be refused rather than treated as unrestricted -- the whole defect this
  // guard closes was that a roleless token could write anything.
  it('refuses a principal carrying no role', () => {
    expect(() => guard.canActivate(contextFor(['admin'], requestAs(null)))).toThrow(
      ProblemException,
    );
  });

  it('refuses with 403, not 401, so the client knows the token was fine', () => {
    try {
      guard.canActivate(contextFor(['admin'], requestAs('buyer')));
      throw new Error('expected the guard to refuse');
    } catch (err) {
      expect(err).toBeInstanceOf(ProblemException);
      expect((err as ProblemException).getStatus()).toBe(403);
    }
  });

  it('accepts any one of several declared roles', () => {
    expect(guard.canActivate(contextFor(['admin', 'staff'], requestAs('staff')))).toBe(true);
  });

  // Belt and braces: JwtAuthGuard runs first and would already have rejected
  // this, but a guard that reads an absent principal must not fall open.
  it('refuses a request that has no principal at all', () => {
    expect(() => guard.canActivate(contextFor(['admin'], {}))).toThrow(ProblemException);
  });
});
