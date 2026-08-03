import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import {
  AddedField,
  DynamicEntityType,
  EntitySchemaRecord,
  EntitySchemaRecordSchema,
  FieldDefinition,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { REDIS } from '../redis/redis.module';
import { schemaSk } from '../persistence/keys';
import { currentTenantId } from '../common/tenant-context';
import { ProblemException } from '../common/problem';
import { failedTransactionIndexes } from '../common/transaction-errors';
import { validateAttributes } from './attribute-validator';
import { setSchemaCacheIfNewer } from './schema-cache';

const EMPTY: EntitySchemaRecord = { version: 0, fields: {} };
const CACHE_TTL_SECONDS = 300;

@Injectable()
export class SchemaRegistryService {
  constructor(
    private readonly repo: DynamoRepository,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private cacheKey(entityType: string): string {
    return `schema:${currentTenantId()}:${entityType}`;
  }

  async get(entityType: DynamicEntityType): Promise<EntitySchemaRecord> {
    const cached = await this.redis.get(this.cacheKey(entityType));
    if (cached) return EntitySchemaRecordSchema.parse(JSON.parse(cached));

    const record = await this.readThrough(entityType);
    // Version-guarded write, not a plain SET: this read may have been in
    // flight while a concurrent `applyAddFields` committed and invalidated
    // the cache. If that write's own (newer) cache population already landed,
    // this stale result must not clobber it. See `setSchemaCacheIfNewer`.
    await setSchemaCacheIfNewer(this.redis, this.cacheKey(entityType), record, CACHE_TTL_SECONDS);
    return record;
  }

  private async readThrough(entityType: DynamicEntityType): Promise<EntitySchemaRecord> {
    const stored = await this.repo.get<{ version: number; fields: Record<string, FieldDefinition> }>(
      schemaSk(entityType),
    );
    return stored ? EntitySchemaRecordSchema.parse({ version: stored.version, fields: stored.fields }) : EMPTY;
  }

  async validate(
    entityType: DynamicEntityType,
    attributes: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { fields } = await this.get(entityType);
    const result = validateAttributes(fields, attributes);
    if (!result.ok) {
      throw new ProblemException(
        'schema-validation-failed',
        422,
        'Attributes do not match the tenant schema',
        `${result.errors.length} attribute error(s)`,
        { errors: result.errors },
      );
    }
    return result.value;
  }

  /** Applies an add-only diff. Returns the new schema version. */
  async applyAddFields(entityType: DynamicEntityType, addedFields: AddedField[]): Promise<number> {
    const names = addedFields.map((f) => f.name);
    const duplicates = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
    if (duplicates.length > 0) {
      throw new ProblemException(
        'unsupported-schema-change',
        422,
        'Duplicate field names in add-fields request',
        `duplicate field name(s): ${duplicates.join(', ')}`,
        { duplicates },
      );
    }

    const invalidDefaults = addedFields
      .filter((f) => f.required && f.default !== null && f.default !== undefined)
      .map((f) => f.name);
    if (invalidDefaults.length > 0) {
      throw new ProblemException(
        'unsupported-schema-change',
        422,
        'A required field must not declare a default',
        `required field(s) must not carry a non-null default: ${invalidDefaults.join(', ')}`,
        { invalidDefaults },
      );
    }

    const current = await this.readThrough(entityType);

    const conflicts = addedFields.filter((f) => f.name in current.fields).map((f) => f.name);
    if (conflicts.length > 0) {
      throw new ProblemException(
        'unsupported-schema-change',
        422,
        'Field already exists',
        `cannot add already-defined field(s): ${conflicts.join(', ')}`,
        { conflicts },
      );
    }

    const fields: Record<string, FieldDefinition> = { ...current.fields };
    for (const f of addedFields) {
      fields[f.name] = { type: f.type, required: f.required, default: f.default ?? null };
    }
    const version = current.version + 1;

    try {
      await this.repo.transactWrite([
        {
          Put: {
            TableName: this.repo.tableName,
            Item: {
              ...this.repo.key(schemaSk(entityType)),
              entityType: 'Schema',
              targetEntity: entityType,
              version,
              fields,
              updatedAt: new Date().toISOString(),
            },
            // Concurrent executions cannot both win: either the record is absent,
            // or its version is still the one we read.
            ConditionExpression: 'attribute_not_exists(PK) OR #v = :expected',
            ExpressionAttributeNames: { '#v': 'version' },
            ExpressionAttributeValues: { ':expected': current.version },
          },
        },
      ]);
    } catch (err) {
      if (failedTransactionIndexes(err).length > 0) {
        throw new ProblemException(
          'schema-version-conflict',
          409,
          'Schema was modified concurrently',
          'the schema version changed between read and write; reload the schema and retry',
        );
      }
      throw err;
    }

    const newRecord: EntitySchemaRecord = { version, fields };
    // Guarded, not a bare invalidate-and-hope: a concurrent `get()` reader
    // that already has this DynamoDB read in flight could otherwise populate
    // the cache with the pre-update record *after* this line runs. Writing
    // the fresh record here, version-guarded, means that late stale write
    // loses the comparison instead of winning it.
    await setSchemaCacheIfNewer(this.redis, this.cacheKey(entityType), newRecord, CACHE_TTL_SECONDS);
    return version;
  }
}
