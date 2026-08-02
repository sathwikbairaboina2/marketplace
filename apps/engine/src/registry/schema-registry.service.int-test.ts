import Redis from 'ioredis';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from './schema-registry.service';
import { runWithTenant } from '../common/tenant-context';
import { ProblemException } from '../common/problem';
import { EnvConfig } from '../config/env.schema';

const env = {
  AWS_REGION: 'us-east-1',
  TABLE_NAME: process.env.TABLE_NAME ?? 'MarketplaceEngine',
  DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
} as EnvConfig;

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
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
});
