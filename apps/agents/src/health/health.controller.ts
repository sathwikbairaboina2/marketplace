import { Controller, Get, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, EnvConfig } from '../config/env.schema';
import { REDIS } from '../redis/redis.module';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: EnvConfig,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ redis: string; ollama: string; engine: string }> {
    await this.redis.ping();

    // Not just "is ollama listening": readiness means the configured model has
    // actually been pulled, otherwise the first conversation fails at inference.
    const tags = await fetch(`${this.env.OLLAMA_BASE_URL}/api/tags`);
    const { models } = (await tags.json()) as { models: { name: string }[] };
    const present = models.some((m) => m.name === this.env.LLM_MODEL);
    if (!present) throw new Error(`model ${this.env.LLM_MODEL} is not pulled`);

    const engine = await fetch(`${this.env.ENGINE_BASE_URL}/api/v1/health/ready`);
    if (!engine.ok) throw new Error('engine is not ready');

    return { redis: 'ok', ollama: 'ok', engine: 'ok' };
  }
}
