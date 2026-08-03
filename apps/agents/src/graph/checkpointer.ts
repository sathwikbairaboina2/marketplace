import { RedisSaver } from '@langchain/langgraph-checkpoint-redis';
import { EnvConfig } from '../config/env.schema';

export const CHECKPOINTER = Symbol('CHECKPOINTER');

/**
 * Conversations expire with the same TTL as their ownership record, so a thread
 * never outlives the record that says who may resume it.
 *
 * `defaultTTL` is expressed in MINUTES by RedisSaver (verified against
 * @langchain/langgraph-checkpoint-redis@1.0.10's `applyTTL`, which does
 * `Math.floor(this.ttlConfig.defaultTTL * 60)` before calling `EXPIRE`), so
 * THREAD_TTL_SECONDS is divided by 60 here to keep the checkpoint TTL and the
 * thread-registry TTL in agreement.
 */
export function createCheckpointer(env: EnvConfig): Promise<RedisSaver> {
  return RedisSaver.fromUrl(env.REDIS_URL, {
    defaultTTL: Math.floor(env.THREAD_TTL_SECONDS / 60),
    refreshOnRead: true,
  });
}
