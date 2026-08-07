import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';

export const IS_PUBLIC = 'isPublic';

// MethodDecorator, not a generic decorator: applying @Public() at class level
// would expose every route in that controller with no way to opt a single
// route back out, since the guard reads getAllAndOverride(handler, class).
//
// `ApiOperation({ security: [] })` rides along so the OpenAPI document and the
// guard can never disagree about which routes are open: an empty
// operation-level `security` array overrides the global bearer requirement
// `setupOpenApi` sets, and OpenAPI 3 treats that override as total, never a
// merge. Both facts come from the one decorator a route already carries.
export const Public = (): MethodDecorator =>
  applyDecorators(SetMetadata(IS_PUBLIC, true), ApiOperation({ security: [] }));
