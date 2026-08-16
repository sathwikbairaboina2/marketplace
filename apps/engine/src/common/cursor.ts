import { BadRequestException } from '@nestjs/common';

export function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

// The only attribute names a LastEvaluatedKey can carry on this table: the
// table's own key schema, plus GSI1's, which a query on the index adds.
const KEY_ATTRIBUTES = new Set(['PK', 'SK', 'GSI1PK', 'GSI1SK']);

export function decodeCursor(cursor: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('cursor is not a valid pagination token');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestException('cursor is not a valid pagination token');
  }

  // Shape, not just type. A cursor is client-controlled input that this
  // process hands to DynamoDB as an ExclusiveStartKey, and DynamoDB answers
  // anything of the wrong shape with `ValidationException: Exclusive Start Key
  // must have same size as table's key schema` -- which surfaced as an
  // unhandled 500 for any attacker-supplied base64 that happened to parse.
  // Checked here, the same input is a 400 with a sentence a client can act on.
  const entries = Object.entries(parsed as Record<string, unknown>);
  const wellFormed =
    entries.length > 0 &&
    entries.every(([name, value]) => KEY_ATTRIBUTES.has(name) && typeof value === 'string') &&
    // The caller supplies the partition key from the authenticated tenant and
    // overwrites whatever arrived, so `SK` is what a usable cursor must carry.
    Object.hasOwn(parsed as object, 'SK');

  if (!wellFormed) {
    throw new BadRequestException('cursor is not a valid pagination token');
  }

  return parsed as Record<string, unknown>;
}
