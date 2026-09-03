import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { productSearchBlob } from '@marketplace/contracts';
import { EnvSchema } from '../config/env.schema';
import { createDocumentClient } from '../persistence/dynamo.client';

/**
 * Products written before the search blob existed do not match text search
 * until their next edit. This walks the whole table once and writes the blob
 * beside every product that lacks one, and only those: the write is
 * conditioned on the attribute still being absent, so a product edited (and
 * therefore blobbed) between the scan and the update is left alone.
 *
 * Every tenant at once, by design -- the scan is not partition-scoped, and a
 * backfill that had to be run once per tenant would be run for some of them.
 *
 * Usage, against the running stack:
 *   pnpm --filter @marketplace/engine build
 *   pnpm --filter @marketplace/engine backfill:search
 * with the engine's own TABLE_NAME / DYNAMODB_ENDPOINT / AWS_* in the environment.
 */
export interface BackfillReport {
  scanned: number;
  updated: number;
  /** Conditioned writes that lost to a concurrent edit; nothing to do for them. */
  skipped: number;
}

type Client = Pick<DynamoDBDocumentClient, 'send'>;

interface ProductLike {
  PK: string;
  SK: string;
  name: string;
  description: string;
  category: string;
}

export async function backfillSearch(client: Client, tableName: string): Promise<BackfillReport> {
  const report: BackfillReport = { scanned: 0, updated: 0, skipped: 0 };
  let startKey: Record<string, unknown> | undefined;

  do {
    const page = await client.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: '#entityType = :product AND attribute_not_exists(#search)',
        ExpressionAttributeNames: { '#entityType': 'entityType', '#search': 'search' },
        ExpressionAttributeValues: { ':product': 'Product' },
        ExclusiveStartKey: startKey,
      }),
    );
    const items = (page.Items ?? []) as ProductLike[];
    report.scanned += items.length;

    for (const item of items) {
      try {
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression: 'SET #search = :blob',
            ConditionExpression: 'attribute_not_exists(#search)',
            ExpressionAttributeNames: { '#search': 'search' },
            ExpressionAttributeValues: { ':blob': productSearchBlob(item) },
          }),
        );
        report.updated += 1;
      } catch (err) {
        if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
          report.skipped += 1;
          continue;
        }
        throw err;
      }
    }

    startKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);

  return report;
}

/* istanbul ignore next -- the CLI shell around the function above. */
if (require.main === module) {
  // Only what the client needs: this runs from a shell, not from the engine's
  // full runtime environment, and must not demand a JWKS URI to touch a table.
  const env = EnvSchema.pick({ AWS_REGION: true, DYNAMODB_ENDPOINT: true, TABLE_NAME: true }).parse(
    process.env,
  );
  backfillSearch(createDocumentClient(env as never), env.TABLE_NAME)
    .then((report) => {
      console.log(
        `backfill-search: scanned ${report.scanned}, updated ${report.updated}, skipped ${report.skipped}`,
      );
    })
    .catch((err) => {
      console.error('backfill-search failed', err);
      process.exit(1);
    });
}
