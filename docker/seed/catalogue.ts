import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DynamoDBClient,
  BatchWriteItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { TABLE_NAME } from './dynamo';

/**
 * The demo catalogue: four tenants, each with products, and enough orders and
 * bookings that no list view is empty on a fresh stack.
 *
 * It is a captured snapshot of records the engine itself wrote, not
 * hand-authored JSON, so the shapes cannot drift from what the API produces --
 * if a record shape changes, re-capture rather than edit by hand.
 *
 * Why seed records directly instead of replaying HTTP calls: the engine
 * enforces one order per `Idempotency-Key` and decrements stock inside a
 * transaction, so replaying calls would either fight those guards or need the
 * stock numbers to be re-derived on every run. Writing the finished rows keeps
 * the seed idempotent -- the same fixture re-applied is a no-op, not a second
 * sale.
 */
const FIXTURE = path.join(__dirname, 'fixtures', 'catalogue.json');

/**
 * Buyer/seller `sub`s only exist at runtime, so the fixture carries
 * `__SUB__<username>__` placeholders. Demo usernames never contain an
 * underscore, which is what makes the delimiter unambiguous.
 */
const SUB_TOKEN = /__SUB__([^_]+)__/g;

export interface CatalogueRecord {
  PK: string;
  SK: string;
  [key: string]: unknown;
}

export function loadCatalogue(): CatalogueRecord[] {
  return JSON.parse(readFileSync(FIXTURE, 'utf8')) as CatalogueRecord[];
}

/** Replaces every placeholder in a string, including inside a GSI partition key. */
function resolveSubs(value: string, subs: Record<string, string>): string {
  return value.replace(SUB_TOKEN, (_whole, username: string) => {
    const sub = subs[username];
    if (!sub) throw new Error(`catalogue fixture references unknown demo user: ${username}`);
    return sub;
  });
}

function marshal(value: unknown, subs: Record<string, string>): AttributeValue {
  if (value === null) return { NULL: true };
  if (typeof value === 'string') return { S: resolveSubs(value, subs) };
  if (typeof value === 'number') return { N: String(value) };
  if (typeof value === 'boolean') return { BOOL: value };
  if (Array.isArray(value)) return { L: value.map((v) => marshal(v, subs)) };
  if (typeof value === 'object') {
    return {
      M: Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, marshal(v, subs)]),
      ),
    };
  }
  throw new Error(`cannot marshal ${typeof value} in catalogue fixture`);
}

export async function seedCatalogue(subs: Record<string, string>): Promise<number> {
  const ddb = new DynamoDBClient({ endpoint: process.env.DYNAMODB_ENDPOINT });
  const records = loadCatalogue();

  const items = records.map((record) => ({
    PutRequest: {
      Item: Object.fromEntries(
        Object.entries(record).map(([k, v]) => [k, marshal(v, subs)]),
      ) as Record<string, AttributeValue>,
    },
  }));

  // BatchWriteItem caps at 25 per call and can return UnprocessedItems without
  // throwing; ignoring that field is how a seed silently writes 24 of 28 rows.
  for (let i = 0; i < items.length; i += 25) {
    let pending = items.slice(i, i + 25);
    for (let attempt = 0; attempt < 5 && pending.length > 0; attempt += 1) {
      const out = await ddb.send(
        new BatchWriteItemCommand({ RequestItems: { [TABLE_NAME]: pending } }),
      );
      pending = (out.UnprocessedItems?.[TABLE_NAME] ?? []) as typeof pending;
      if (pending.length > 0) await new Promise((r) => setTimeout(r, 2 ** attempt * 25));
    }
    if (pending.length > 0) {
      throw new Error(`catalogue seed left ${pending.length} item(s) unwritten`);
    }
  }

  console.log(`seeded ${records.length} catalogue records`);
  return records.length;
}
