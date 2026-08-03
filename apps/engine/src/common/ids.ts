import { createHash } from 'node:crypto';
import { ulid } from 'ulid';

export function newId(): string {
  return ulid();
}

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Deterministically derives a 26-character, Crockford-base32-encoded id from an arbitrary input
 * string. Same alphabet and length as `newId()`'s ULIDs -- so it is shape-compatible with every
 * other id in the system -- but it is a hash, not a ULID: it carries no time-ordering guarantee.
 *
 * Used by the SQS consumer (Task 16) to turn a message's `MessageId` into a Flow id, so the same
 * message always derives the same id. Combined with `DynamoRepository.putIfAbsent`, that makes
 * Flow creation idempotent on the write itself -- a redelivered message's second write is a
 * DynamoDB no-op -- rather than depending solely on the consumer's best-effort Redis dedupe
 * claim, which cannot by itself distinguish "definitely not written" from "outcome unknown"
 * (e.g. the write committed but the client timed out before seeing the response).
 */
export function deriveIdFrom(input: string): string {
  const digest = createHash('sha256').update(input).digest();
  let bits = '';
  for (const byte of digest) {
    bits += byte.toString(2).padStart(8, '0');
  }
  let out = '';
  for (let i = 0; out.length < 26; i += 5) {
    out += CROCKFORD_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}
