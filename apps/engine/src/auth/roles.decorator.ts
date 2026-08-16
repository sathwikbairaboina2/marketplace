import { SetMetadata } from '@nestjs/common';

export const ROLES = 'roles';

/**
 * Declares which roles may reach a route. Absent metadata means "any
 * authenticated principal", which is the right default for reads and for the
 * routes a buyer exists to use -- placing an order, booking a ticket.
 *
 * MethodDecorator by choice, matching `@Public()`: a class-level role would
 * apply to every route in a controller with no way to opt one back out, and
 * every controller here mixes writes that need a role with reads that do not.
 */
export const Roles = (...roles: string[]): MethodDecorator => SetMetadata(ROLES, roles);
