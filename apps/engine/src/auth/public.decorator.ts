import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

// MethodDecorator, not a generic decorator: applying @Public() at class level
// would expose every route in that controller with no way to opt a single
// route back out, since the guard reads getAllAndOverride(handler, class).
export const Public = (): MethodDecorator => SetMetadata(IS_PUBLIC, true);
