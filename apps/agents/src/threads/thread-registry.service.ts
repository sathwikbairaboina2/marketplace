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
    const owner = this.parseOwner(stored);

    // Absent, expired, corrupt and another tenant's are one outcome on
    // purpose: a distinguishable error (including a 500 from a parse
    // failure) would confirm that the thread exists.
    if (
      !owner ||
      !owner.tenantId ||
      !principal.tenantId ||
      owner.tenantId !== principal.tenantId
    ) {
      throw new ProblemException('thread-not-found', 404, 'No such thread', threadId);
    }
  }

  private parseOwner(stored: string | null): ThreadOwner | null {
    if (!stored) {
      return null;
    }
    try {
      return JSON.parse(stored) as ThreadOwner;
    } catch {
      // A record that fails to parse (schema drift, a bug elsewhere, or
      // tampering) must be indistinguishable from an absent one.
      return null;
    }
  }

  /**
   * Ownership is asserted here rather than left to the caller. A bare TTL
   * refresh would let anyone holding a leaked thread id keep another
   * tenant's conversation alive indefinitely, and this is the one class of
   * gap this service exists to close — so the public API must make that
   * unreachable rather than rely on every future caller remembering to
   * check first.
   */
  async touch(threadId: string, principal: TenantPrincipal): Promise<void> {
    await this.assertOwned(threadId, principal);
    await this.redis.expire(this.key(threadId), this.env.THREAD_TTL_SECONDS);
  }
}
