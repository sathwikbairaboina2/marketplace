import { Controller, Get } from '@nestjs/common';
import { currentPrincipal, TenantPrincipal } from '../common/tenant-context';

@Controller('me')
export class MeController {
  @Get()
  me(): TenantPrincipal {
    return currentPrincipal();
  }
}
