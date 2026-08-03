import Redis from 'ioredis';
import { EntitySchemaRecord } from '@marketplace/contracts';
import { setSchemaCacheIfNewer } from './schema-cache';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const uniqKey = () => `schema-cache-test:${Math.random().toString(36).slice(2, 10)}`;

afterAll(async () => {
  await redis.quit();
});

describe('setSchemaCacheIfNewer', () => {
  it('writes when nothing is cached yet', async () => {
    const key = uniqKey();
    const record: EntitySchemaRecord = { version: 1, fields: {} };

    const wrote = await setSchemaCacheIfNewer(redis, key, record, 60);

    expect(wrote).toBe(true);
    expect(JSON.parse((await redis.get(key))!)).toEqual(record);
  });

  it('refuses to overwrite a newer cached version with an older one', async () => {
    const key = uniqKey();
    const newer: EntitySchemaRecord = {
      version: 2,
      fields: { a: { type: 'string', required: false, default: null } },
    };
    const stale: EntitySchemaRecord = { version: 1, fields: {} };

    // Simulates applyAddFields's guarded write landing first, at v2.
    expect(await setSchemaCacheIfNewer(redis, key, newer, 60)).toBe(true);

    // Simulates a `get()` populate-on-miss that read the pre-update (v1) record
    // from DynamoDB before the writer committed. It must lose this race.
    const wroteStale = await setSchemaCacheIfNewer(redis, key, stale, 60);

    expect(wroteStale).toBe(false);
    expect(JSON.parse((await redis.get(key))!)).toEqual(newer);
  });

  it('overwrites an older cached version with a newer one', async () => {
    const key = uniqKey();
    const older: EntitySchemaRecord = { version: 1, fields: {} };
    const newer: EntitySchemaRecord = { version: 2, fields: {} };

    expect(await setSchemaCacheIfNewer(redis, key, older, 60)).toBe(true);
    expect(await setSchemaCacheIfNewer(redis, key, newer, 60)).toBe(true);

    expect(JSON.parse((await redis.get(key))!)).toEqual(newer);
  });

  it('rejects a write of the same version already cached', async () => {
    const key = uniqKey();
    const record: EntitySchemaRecord = { version: 3, fields: {} };

    expect(await setSchemaCacheIfNewer(redis, key, record, 60)).toBe(true);
    expect(await setSchemaCacheIfNewer(redis, key, record, 60)).toBe(false);
  });
});
