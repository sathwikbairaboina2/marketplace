import Redis from 'ioredis';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from './schema-registry.service';
import { runWithTenant } from '../common/tenant-context';
import { ProblemException } from '../common/problem';
import { EnvConfig } from '../config/env.schema';

const env = {
  AWS_REGION: 'us-east-1',
  TABLE_NAME: process.env.TABLE_NAME ?? 'MarketplaceEngine',
  DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:38000',
} as EnvConfig;

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:36379');
const repo = new DynamoRepository(env);
const registry = new SchemaRegistryService(repo, redis);

const asTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
  runWithTenant({ tenantId, userId: 'user-1', role: null }, fn);
const uniq = () => `t_${Math.random().toString(36).slice(2, 10)}`;

afterAll(async () => {
  await redis.quit();
});

describe('SchemaRegistryService', () => {
  it('returns an empty schema at version 0 for a new tenant', async () => {
    const schema = await asTenant(uniq(), () => registry.get('Product'));
    expect(schema).toEqual({ version: 0, fields: {} });
  });

  it('adds fields and bumps the version', async () => {
    const t = uniq();
    const v1 = await asTenant(t, () =>
      registry.applyAddFields('Product', [
        { name: 'dietaryNeeds', type: 'string', required: false, default: null },
      ]),
    );
    expect(v1).toBe(1);

    const schema = await asTenant(t, () => registry.get('Product'));
    expect(schema.version).toBe(1);
    expect(schema.fields.dietaryNeeds.type).toBe('string');
  });

  it('rejects adding a field that already exists', async () => {
    const t = uniq();
    const field = { name: 'dietaryNeeds', type: 'string' as const, required: false, default: null };
    await asTenant(t, () => registry.applyAddFields('Product', [field]));
    await expect(asTenant(t, () => registry.applyAddFields('Product', [field]))).rejects.toBeInstanceOf(
      ProblemException,
    );
  });

  it('enforces the schema on validate and invalidates its cache on write', async () => {
    const t = uniq();
    await asTenant(t, () => registry.validate('Product', {}));

    await asTenant(t, () =>
      registry.applyAddFields('Product', [
        { name: 'seats', type: 'number', required: true, default: null },
      ]),
    );

    await expect(asTenant(t, () => registry.validate('Product', {}))).rejects.toBeInstanceOf(
      ProblemException,
    );
    expect(await asTenant(t, () => registry.validate('Product', { seats: 2 }))).toEqual({ seats: 2 });
  });

  it('keeps registries separate across tenants', async () => {
    const a = uniq();
    const b = uniq();
    await asTenant(a, () =>
      registry.applyAddFields('Product', [
        { name: 'onlyForA', type: 'string', required: false, default: null },
      ]),
    );
    expect((await asTenant(b, () => registry.get('Product'))).fields).toEqual({});
  });

  it('rejects duplicate field names within one applyAddFields call instead of silently collapsing them', async () => {
    const t = uniq();

    const err = await asTenant(t, () =>
      registry.applyAddFields('Product', [
        { name: 'dup', type: 'string', required: false, default: null },
        { name: 'dup', type: 'number', required: false, default: null },
      ]),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ProblemException);
    expect((err as ProblemException).getStatus()).toBe(422);
    // Nothing should have been written: the schema stays at version 0.
    expect((await asTenant(t, () => registry.get('Product'))).version).toBe(0);
  });

  it('rejects a required field that declares a non-null default', async () => {
    const t = uniq();

    const err = await asTenant(t, () =>
      registry.applyAddFields('Product', [{ name: 'seats', type: 'number', required: true, default: 4 }]),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ProblemException);
    expect((err as ProblemException).getStatus()).toBe(422);
    expect((await asTenant(t, () => registry.get('Product'))).version).toBe(0);
  });

  it('surfaces a lost schema-version race as a 409 conflict, not a bare 500', async () => {
    const t = uniq();

    // Establish a real schema at version 1.
    await asTenant(t, () =>
      registry.applyAddFields('Product', [{ name: 'fieldA', type: 'string', required: false, default: null }]),
    );

    // Simulate a caller whose read of the current record raced with (and lost to)
    // another writer: force the next `repo.get` — the one `applyAddFields`'s
    // `readThrough` performs — to return the stale pre-update record (v0) even
    // though DynamoDB actually holds v1. Its conditional Put must then fail
    // against the version DynamoDB really has, and that failure must surface
    // as a structured 409, not a bare 500.
    const getSpy = jest.spyOn(repo, 'get').mockResolvedValueOnce({ version: 0, fields: {} });

    const err = await asTenant(t, () =>
      registry.applyAddFields('Product', [{ name: 'fieldB', type: 'string', required: false, default: null }]),
    ).catch((e) => e);

    getSpy.mockRestore();

    expect(err).toBeInstanceOf(ProblemException);
    expect((err as ProblemException).getStatus()).toBe(409);
  });
});
