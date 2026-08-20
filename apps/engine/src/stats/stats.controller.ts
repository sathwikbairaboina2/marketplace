import { Controller, Get } from '@nestjs/common';
import { SalesStats } from '@marketplace/contracts';
import { Roles } from '../auth/roles.decorator';
import { StatsService } from './stats.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  // Declared here as well as checked in the service, like every admin read
  // that crosses per-user scoping.
  @Get('sales')
  @Roles('admin')
  sales(): Promise<SalesStats> {
    return this.stats.sales();
  }
}
