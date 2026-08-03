import { Controller, Get, Param } from '@nestjs/common';
import { currentPrincipal } from '@marketplace/auth';
import { AgentStateSnapshot } from '@marketplace/contracts';
import { GraphService } from '../graph/graph.service';
import { ThreadRegistryService } from './thread-registry.service';

@Controller('threads')
export class ThreadsController {
  constructor(
    private readonly threads: ThreadRegistryService,
    private readonly graph: GraphService,
  ) {}

  @Get(':id')
  async get(@Param('id') id: string): Promise<AgentStateSnapshot> {
    await this.threads.assertOwned(id, currentPrincipal());
    return this.graph.snapshot(id);
  }
}
