import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { backfillSearch } from './backfill-search';

const product = (sk: string, name: string, extra: Record<string, unknown> = {}) => ({
  PK: 'TENANT#acme',
  SK: sk,
  entityType: 'Product',
  name,
  description: 'Hand thrown',
  category: 'Kitchen',
  ...extra,
});

describe('backfillSearch', () => {
  it('writes a blob for every product the scan returns, across pages', async () => {
    const pages = [
      { Items: [product('PRODUCT#1', 'Mug')], LastEvaluatedKey: { PK: 'TENANT#acme', SK: 'PRODUCT#1' } },
      { Items: [product('PRODUCT#2', 'Jug')] },
    ];
    const sent: unknown[] = [];
    const client = {
      send: jest.fn(async (cmd: unknown) => {
        sent.push(cmd);
        if (cmd instanceof ScanCommand) return pages.shift();
        return {};
      }),
    };

    const report = await backfillSearch(client as never, 'Table');

    expect(report).toEqual({ scanned: 2, updated: 2, skipped: 0 });
    const updates = sent.filter((c) => c instanceof UpdateCommand) as UpdateCommand[];
    expect(updates).toHaveLength(2);
    expect(updates[0].input).toMatchObject({
      Key: { PK: 'TENANT#acme', SK: 'PRODUCT#1' },
      ConditionExpression: 'attribute_not_exists(#search)',
      ExpressionAttributeValues: { ':blob': 'mug hand thrown kitchen' },
    });
    // The second scan continues from where the first stopped.
    const scans = sent.filter((c) => c instanceof ScanCommand) as ScanCommand[];
    expect(scans[1].input.ExclusiveStartKey).toEqual({ PK: 'TENANT#acme', SK: 'PRODUCT#1' });
  });

  it('asks the table only for products that lack a blob', async () => {
    const send = jest.fn(async (_cmd: unknown) => ({ Items: [] }));

    await backfillSearch({ send } as never, 'Table');

    const scan = send.mock.calls[0][0] as ScanCommand;
    expect(scan.input.FilterExpression).toBe('#entityType = :product AND attribute_not_exists(#search)');
  });

  it('counts a product edited between scan and write as skipped, and carries on', async () => {
    let first = true;
    const client = {
      send: jest.fn(async (cmd: unknown) => {
        if (cmd instanceof ScanCommand) {
          return { Items: [product('PRODUCT#1', 'Mug'), product('PRODUCT#2', 'Jug')] };
        }
        if (first) {
          first = false;
          throw Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });
        }
        return {};
      }),
    };

    const report = await backfillSearch(client as never, 'Table');

    expect(report).toEqual({ scanned: 2, updated: 1, skipped: 1 });
  });

  it('lets any other write failure propagate', async () => {
    const client = {
      send: jest.fn(async (cmd: unknown) => {
        if (cmd instanceof ScanCommand) return { Items: [product('PRODUCT#1', 'Mug')] };
        throw new Error('table on fire');
      }),
    };

    await expect(backfillSearch(client as never, 'Table')).rejects.toThrow('table on fire');
  });
});
