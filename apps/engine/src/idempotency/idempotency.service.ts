import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { currentTenantId } from '../common/tenant-context';
import { REDIS } from '../redis/redis.module';
import { ProblemException } from '../common/problem';

const IN_PROGRESS = '__in_progress__';
const TTL_SECONDS = 24 * 60 * 60;

export type BeginResult = { status: 'new' } | { status: 'replay'; response: unknown };

@Injectable()
export class IdempotencyService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private key(idempotencyKey: string): string {
    return `idem:${currentTenantId()}:${idempotencyKey}`;
  }

  async begin(idempotencyKey: string): Promise<BeginResult> {
    const key = this.key(idempotencyKey);
    const claimed = await this.redis.set(key, IN_PROGRESS, 'EX', TTL_SECONDS, 'NX');
    if (claimed === 'OK') return { status: 'new' };

    const stored = await this.redis.get(key);
    if (stored === null) return { status: 'new' };
    if (stored === IN_PROGRESS) {
      throw new ProblemException(
        'request-in-progress',
        409,
        'Request in progress',
        'a request with this Idempotency-Key is still being processed',
      );
    }
    return { status: 'replay', response: JSON.parse(stored) as unknown };
  }

  async complete(idempotencyKey: string, response: unknown): Promise<void> {
    await this.redis.set(this.key(idempotencyKey), JSON.stringify(response), 'EX', TTL_SECONDS);
  }

  async release(idempotencyKey: string): Promise<void> {
    await this.redis.del(this.key(idempotencyKey));
  }
}
