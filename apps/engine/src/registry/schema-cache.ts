import Redis from 'ioredis';
import { EntitySchemaRecord } from '@marketplace/contracts';

// Atomic compare-and-set: only replaces the cached value when none exists yet,
// or when the cached value's `version` is strictly less than the incoming one.
// Implemented as a Lua script so the read-compare-write is a single atomic
// operation on the Redis server — no separate GET/SET round trip that could
// itself be raced by a concurrent writer.
const SET_IF_NEWER_SCRIPT = `
local cached = redis.call('GET', KEYS[1])
if cached then
  local ok, decoded = pcall(cjson.decode, cached)
  if ok and type(decoded) == 'table' and decoded.version ~= nil
     and tonumber(decoded.version) >= tonumber(ARGV[2]) then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1
`;

/**
 * Writes `record` to `key` unless a cached value is already present with a
 * version greater than or equal to `record.version`, in which case the
 * write is skipped and the existing (newer-or-equal) cached value is kept.
 *
 * This closes the read-after-invalidate race: a cache-populating write that
 * was computed from a stale read (e.g. `get()`'s `readThrough` was in flight
 * before a concurrent `applyAddFields` committed and invalidated the cache)
 * can land *after* the newer value is already cached, but can never
 * overwrite it, because the comparison and the write happen atomically on
 * the Redis server.
 *
 * Returns true if the write was applied, false if it was rejected as stale
 * or no-newer.
 */
export async function setSchemaCacheIfNewer(
  redis: Redis,
  key: string,
  record: EntitySchemaRecord,
  ttlSeconds: number,
): Promise<boolean> {
  const result = await redis.eval(SET_IF_NEWER_SCRIPT, 1, key, JSON.stringify(record), record.version, ttlSeconds);
  return result === 1;
}
