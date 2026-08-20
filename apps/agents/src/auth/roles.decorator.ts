import { SetMetadata } from '@nestjs/common';

export const ROLES = 'roles';

/**
 * Route-level role restriction, mirroring the engine's: the decorator is what
 * makes the restriction visible on the route and in the OpenAPI document; the
 * service check is what the unit tests pin and what protects a non-HTTP
 * caller. Both are required on admin-only routes, here as there.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES, roles);
