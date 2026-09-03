import { createHmac, timingSafeEqual } from 'node:crypto';
import { newId } from '../common/ids';

/**
 * A guest is a coat-check ticket: an id the engine minted, signed so a client
 * cannot forge one, bound to the shop it was minted for so a ticket from
 * `acme` presented on `globex` is nobody's. No claims, no expiry -- a cart is
 * not worth a JWT's ceremony, and the id is all the cart routes key on.
 *
 * Wire form: `<ulid>.<hmac-sha256 hex>`, the HMAC over `tenantId + "\n" + ulid`.
 */
const ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function sign(secret: string, tenantId: string, id: string): string {
  return createHmac('sha256', secret).update(`${tenantId}\n${id}`).digest('hex');
}

export function mintGuest(secret: string, tenantId: string): string {
  const id = newId();
  return `${id}.${sign(secret, tenantId, id)}`;
}

/** The guest id when the token is genuine for this tenant, null otherwise. */
export function verifyGuest(secret: string, tenantId: string, token: string | undefined): string | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const id = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!ID.test(id)) return null;
  const expected = sign(secret, tenantId, id);
  if (mac.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(mac, 'utf8'), Buffer.from(expected, 'utf8')) ? id : null;
}

/** The principal's user id for a guest: namespaced so it can never collide with a Cognito sub. */
export const guestUserId = (id: string): string => `guest:${id}`;
