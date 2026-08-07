import { Controller, HttpCode, HttpStatus, Post, SetMetadata } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { DevTokenService } from './dev-token.service';

// Duplicated deliberately: both apps' `auth/public.decorator.ts` define
// `IS_PUBLIC = 'isPublic'` and their `JwtAuthGuard` reads it via
// `Reflector.getAllAndOverride(IS_PUBLIC, ...)`. This package cannot import
// either app's decorator -- apps depend on packages, never the reverse --
// so it sets the same metadata key directly. The guard matches on this
// string value, not on which module's constant produced it.
const IS_PUBLIC = 'isPublic';

@Controller('dev/token')
export class DevTokenController {
  constructor(private readonly devToken: DevTokenService) {}

  @SetMetadata(IS_PUBLIC, true)
  @ApiOperation({ security: [] })
  @HttpCode(HttpStatus.OK)
  @Post()
  async mint(): Promise<{ token: string }> {
    return { token: await this.devToken.mint() };
  }
}
