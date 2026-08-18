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
  /**
   * Oldest first. Listings want the default (newest first) -- the listing
   * somebody just added should be on the first page. A conversation wants the
   * opposite: read top to bottom, a thread that arrives newest-first reads
   * backwards.
   */
  ascending?: boolean;
}

type TransactItems = TransactWriteCommandInput['TransactItems'];
type TransactItem = NonNullable<TransactItems>[number];

const RESERVED_FILTER_KEYS = [':pk', ':sk'];

// How many Query round-trips one filtered page may cost. Ten pages of 25 is
// 250 rows examined for a page of 25 -- enough to find matches that are merely
// unlucky, and a hard stop before a filter that matches nothing walks an entire
// partition on every request.
const FILTERED_READ_BUDGET = 10;

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
    const wanted = opts.limit;
    const collected: T[] = [];
    let startKey: Record<string, unknown> | undefined = opts.cursor
      ? { ...decodeCursor(opts.cursor), PK: pk }
      : undefined;
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    let reads = 0;

    // DynamoDB applies `Limit` to the items it reads and the FilterExpression
    // afterwards, so one Query answers "nothing matched" whenever the matches
    // sit behind other rows. Unfiltered that is fine -- every row read is a row
    // returned -- but filtered it produced a shop that told a buyer it had no
    // products while holding several that matched their price range.
    //
    // So: keep reading until the page the caller asked for is full, the
    // partition is exhausted, or the read budget runs out. The budget is what
    // keeps a filter that matches nothing from walking a whole partition on
    // every request; when it stops early the cursor is still returned, so the
    // caller can continue rather than being told the search is over.
    do {
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
          Limit: wanted,
          ExclusiveStartKey: startKey,
          // Newest first by default, matching `queryUserIndex` below. Sort keys end
          // in a ULID, so descending order is creation order reversed: the listing
          // somebody just added is on the first page, not the last. `ascending`
          // flips it for the one caller that reads a sequence rather than a list.
          ScanIndexForward: opts.ascending === true,
        }),
      );

      collected.push(...((out.Items ?? []) as T[]));
      lastEvaluatedKey = out.LastEvaluatedKey;
      startKey = out.LastEvaluatedKey;
      reads += 1;
    } while (
      opts.filter &&
      startKey &&
      (wanted === undefined || collected.length < wanted) &&
      reads < FILTERED_READ_BUDGET
    );

    // Trimming to `limit` means the caller's next page has to resume from the
    // last row actually handed over, not from the last row read -- otherwise
    // everything between the two is skipped. Records carry their own PK/SK, so
    // that resume point is exactly the last item returned.
    const items = wanted === undefined ? collected : collected.slice(0, wanted);
    const trimmed = items.length < collected.length;
    const last = items[items.length - 1] as { PK?: string; SK?: string } | undefined;

    let nextCursor: string | null = null;
    if (trimmed && last?.PK && last?.SK) {
      nextCursor = encodeCursor({ PK: last.PK, SK: last.SK });
    } else if (!trimmed && lastEvaluatedKey) {
      nextCursor = encodeCursor(lastEvaluatedKey);
    }

    return { items, nextCursor };
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
        if (next.Put.Item) this.assertOwnGsi1Pk(next.Put.Item);
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
