import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { currentPrincipal } from '../common/tenant-context';
import { REDIS } from '../redis/redis.module';
import { ProblemException } from '../common/problem';

const IN_PROGRESS = '__in_progress__';
const TTL_SECONDS = 24 * 60 * 60;

export type BeginResult = { status: 'new' } | { status: 'replay'; response: unknown };

@Injectable()
export class IdempotencyService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private key(idempotencyKey: string): string {
    // `Idempotency-Key` values are chosen by the client, not generated here -- two different
    // users in the same tenant can easily pick the same string (an order id, a cart id, a retry
    // counter). Scoping by tenant alone would let user B's request find user A's completed
    // key and replay A's response verbatim: a cross-user data leak (B receives A's order) and
    // silent data loss (B's own request never runs). Scoping by user as well, taken from the
    // ambient principal the same way the tenant is, closes that the same way `GET /orders/:id`'s
    // ownership check closes the analogous read-path leak.
    const principal = currentPrincipal();
    return `idem:${principal.tenantId}:${principal.userId}:${idempotencyKey}`;
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
