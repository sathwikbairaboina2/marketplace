import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { Inject, Injectable } from '@nestjs/common';
import { Page } from '@marketplace/contracts';
import { ENV, EnvConfig } from '../config/env.schema';
import { currentTenantId } from '../common/tenant-context';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { createDocumentClient } from './dynamo.client';
import { gsi1UserPk, tenantPk } from './keys';

export interface FilterSpec {
  expression: string;
  names?: Record<string, string>;
  values: Record<string, unknown>;
}

export interface PageOptions {
  limit?: number;
  cursor?: string | null;
}

export interface QueryOptions extends PageOptions {
  filter?: FilterSpec;
}

type TransactItems = TransactWriteCommandInput['TransactItems'];
type TransactItem = NonNullable<TransactItems>[number];

const RESERVED_FILTER_KEYS = [':pk', ':sk'];

@Injectable()
export class DynamoRepository {
  private readonly doc: DynamoDBDocumentClient;
  readonly tableName: string;

  constructor(@Inject(ENV) env: EnvConfig) {
    this.doc = createDocumentClient(env);
    this.tableName = env.TABLE_NAME;
  }

  key(sk: string): { PK: string; SK: string } {
    return { PK: tenantPk(currentTenantId()), SK: sk };
  }

  async put(sk: string, item: Record<string, unknown>): Promise<void> {
    this.assertOwnGsi1Pk(item);
    await this.doc.send(
      new PutCommand({ TableName: this.tableName, Item: { ...item, ...this.key(sk) } }),
    );
  }

  async putIfAbsent(sk: string, item: Record<string, unknown>): Promise<boolean> {
    this.assertOwnGsi1Pk(item);
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tableName,
          Item: { ...item, ...this.key(sk) },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return false;
      throw err;
    }
  }

  async get<T>(sk: string): Promise<T | null> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: this.key(sk) }),
    );
    return (out.Item as T | undefined) ?? null;
  }

  async queryPrefix<T>(prefix: string, opts: QueryOptions = {}): Promise<Page<T>> {
    const filterValues = opts.filter?.values ?? {};
    for (const reserved of RESERVED_FILTER_KEYS) {
      if (Object.prototype.hasOwnProperty.call(filterValues, reserved)) {
        throw new Error(
          `filter values must not use the reserved key "${reserved}" (it is reserved for the tenant-scoped key condition)`,
        );
      }
    }
    const pk = tenantPk(currentTenantId());
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        FilterExpression: opts.filter?.expression,
        ExpressionAttributeNames: opts.filter?.names,
        ExpressionAttributeValues: {
          // Filter values are spread first so the tenant-derived `:pk`/`:sk` always win even
          // though the reserved-key check above should already have rejected a collision.
          ...filterValues,
          ':pk': pk,
          ':sk': prefix,
        },
        Limit: opts.limit,
        ExclusiveStartKey: opts.cursor ? { ...decodeCursor(opts.cursor), PK: pk } : undefined,
      }),
    );
    return {
      items: (out.Items ?? []) as T[],
      nextCursor: out.LastEvaluatedKey ? encodeCursor(out.LastEvaluatedKey) : null,
    };
  }

  async queryUserIndex<T>(userId: string, prefix: string, opts: PageOptions = {}): Promise<Page<T>> {
    const gsi1Pk = gsi1UserPk(currentTenantId(), userId);
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': gsi1Pk,
          ':sk': prefix,
        },
        Limit: opts.limit,
        ExclusiveStartKey: opts.cursor ? { ...decodeCursor(opts.cursor), GSI1PK: gsi1Pk } : undefined,
        ScanIndexForward: false,
      }),
    );
    return {
      items: (out.Items ?? []) as T[],
      nextCursor: out.LastEvaluatedKey ? encodeCursor(out.LastEvaluatedKey) : null,
    };
  }

  async transactWrite(items: TransactItems): Promise<void> {
    const expectedPk = tenantPk(currentTenantId());
    const guarded = (items ?? []).map((entry): TransactItem => {
      const next: TransactItem = { ...entry };
      // `?? this.tableName` (rather than spread ordering) so an explicit `TableName: undefined`
      // — which the SDK's own types require callers to write, since `TableName` is a mandatory
      // key of type `string | undefined` — still gets defaulted instead of clobbering it.
      if (next.Put) {
        this.assertTenantKey(next.Put.Item, expectedPk);
        next.Put = { ...next.Put, TableName: next.Put.TableName ?? this.tableName };
      }
      if (next.Update) {
        this.assertTenantKey(next.Update.Key, expectedPk);
        next.Update = { ...next.Update, TableName: next.Update.TableName ?? this.tableName };
      }
      if (next.Delete) {
        this.assertTenantKey(next.Delete.Key, expectedPk);
        next.Delete = { ...next.Delete, TableName: next.Delete.TableName ?? this.tableName };
      }
      if (next.ConditionCheck) {
        this.assertTenantKey(next.ConditionCheck.Key, expectedPk);
        next.ConditionCheck = {
          ...next.ConditionCheck,
          TableName: next.ConditionCheck.TableName ?? this.tableName,
        };
      }
      return next;
    });
    await this.doc.send(new TransactWriteCommand({ TransactItems: guarded }));
  }

  private assertOwnGsi1Pk(item: Record<string, unknown>): void {
    if (!('GSI1PK' in item) || item.GSI1PK === undefined) return;
    const expectedPrefix = `TENANT#${currentTenantId()}#`;
    if (typeof item.GSI1PK !== 'string' || !item.GSI1PK.startsWith(expectedPrefix)) {
      throw new Error(
        `GSI1PK "${String(item.GSI1PK)}" does not belong to the current tenant (expected prefix "${expectedPrefix}")`,
      );
    }
  }

  private assertTenantKey(record: Record<string, unknown> | undefined, expectedPk: string): void {
    if (!record || !('PK' in record) || record.PK === undefined) return;
    if (record.PK !== expectedPk) {
      throw new Error(
        `transactWrite item PK "${String(record.PK)}" does not belong to the current tenant (expected "${expectedPk}")`,
      );
    }
  }
}
