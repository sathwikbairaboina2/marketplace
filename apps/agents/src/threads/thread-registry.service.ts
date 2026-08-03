import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { ulid } from 'ulid';
import { TenantPrincipal } from '@marketplace/auth';
import { ENV, EnvConfig } from '../config/env.schema';
import { REDIS } from '../redis/redis.module';
import { ProblemException } from '../common/problem';

export interface ThreadOwner {
  tenantId: string;
  userId: string;
  createdAt: string;
}

@Injectable()
export class ThreadRegistryService {
  constructor(
    @Inject(ENV) private readonly env: EnvConfig,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private key(threadId: string): string {
    return `thread:${threadId}`;
  }

  async create(principal: TenantPrincipal): Promise<string> {
    const threadId = ulid();
    const owner: ThreadOwner = {
      tenantId: principal.tenantId,
      userId: principal.userId,
      createdAt: new Date().toISOString(),
    };
    await this.redis.set(
      this.key(threadId),
      JSON.stringify(owner),
      'EX',
      this.env.THREAD_TTL_SECONDS,
    );
    return threadId;
  }

  async assertOwned(threadId: string, principal: TenantPrincipal): Promise<void> {
    const stored = await this.redis.get(this.key(threadId));
    const owner = stored ? (JSON.parse(stored) as ThreadOwner) : null;

    // Absent, expired and another tenant's are one outcome on purpose: a
    // distinguishable error would confirm that the thread exists.
    if (!owner || owner.tenantId !== principal.tenantId) {
      throw new ProblemException('thread-not-found', 404, 'No such thread', threadId);
    }
  }

  async touch(threadId: string): Promise<void> {
    await this.redis.expire(this.key(threadId), this.env.THREAD_TTL_SECONDS);
  }
}
