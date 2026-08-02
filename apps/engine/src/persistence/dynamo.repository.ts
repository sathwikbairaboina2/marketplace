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
  names: Record<string, string>;
  values: Record<string, unknown>;
}

export interface QueryOptions {
  limit?: number;
  cursor?: string | null;
  filter?: FilterSpec;
}

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
    await this.doc.send(
      new PutCommand({ TableName: this.tableName, Item: { ...item, ...this.key(sk) } }),
    );
  }

  async putIfAbsent(sk: string, item: Record<string, unknown>): Promise<boolean> {
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
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        FilterExpression: opts.filter?.expression,
        ExpressionAttributeNames: opts.filter?.names,
        ExpressionAttributeValues: {
          ':pk': tenantPk(currentTenantId()),
          ':sk': prefix,
          ...(opts.filter?.values ?? {}),
        },
        Limit: opts.limit,
        ExclusiveStartKey: opts.cursor ? decodeCursor(opts.cursor) : undefined,
      }),
    );
    return {
      items: (out.Items ?? []) as T[],
      nextCursor: out.LastEvaluatedKey ? encodeCursor(out.LastEvaluatedKey) : null,
    };
  }

  async queryUserIndex<T>(userId: string, prefix: string, opts: QueryOptions = {}): Promise<Page<T>> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': gsi1UserPk(currentTenantId(), userId),
          ':sk': prefix,
        },
        Limit: opts.limit,
        ExclusiveStartKey: opts.cursor ? decodeCursor(opts.cursor) : undefined,
        ScanIndexForward: false,
      }),
    );
    return {
      items: (out.Items ?? []) as T[],
      nextCursor: out.LastEvaluatedKey ? encodeCursor(out.LastEvaluatedKey) : null,
    };
  }

  async transactWrite(items: TransactWriteCommandInput['TransactItems']): Promise<void> {
    await this.doc.send(new TransactWriteCommand({ TransactItems: items }));
  }
}
