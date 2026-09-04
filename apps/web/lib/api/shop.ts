import {
  AnnouncementSchema,
  BookingResponseSchema,
  DepositPolicySchema,
  ShopContactSchema,
  type Card,
  CartResponseSchema,
  type CreateBooking,
  EventResponseSchema,
  type GuestCheckoutRequest,
  GuestTokenResponseSchema,
  OrderResponseSchema,
  ProductResponseSchema,
  SchemaListSchema,
  StorefrontPublicResponseSchema,
  type SearchProducts,
  pageOf,
} from '@marketplace/contracts';
import { request } from './http';

/**
 * The public read surface: what a stranger may see of one shop. Same
 * contracts as the token wrappers, different route -- the engine, not this
 * client, decides what is visible.
 */
const Products = pageOf(ProductResponseSchema);
const Events = pageOf(EventResponseSchema);
const base = (tenantId: string) => `/shops/${encodeURIComponent(tenantId)}`;

export const publicListProducts = (tenantId: string, limit: number, cursor: string | null) =>
  request(`${base(tenantId)}/products`, {
    query: { limit, cursor: cursor ?? undefined },
    schema: Products,
  });

export const publicSearchProducts = (tenantId: string, body: SearchProducts) =>
  request(`${base(tenantId)}/products/search`, { method: 'POST', body, schema: Products });

export const publicGetProduct = (tenantId: string, id: string) =>
  request(`${base(tenantId)}/products/${id}`, { schema: ProductResponseSchema });

export const publicListEvents = (tenantId: string, limit: number, cursor: string | null) =>
  request(`${base(tenantId)}/events`, {
    query: { limit, cursor: cursor ?? undefined },
    schema: Events,
  });

export const publicGetEvent = (tenantId: string, id: string) =>
  request(`${base(tenantId)}/events/${id}`, { schema: EventResponseSchema });

export const publicGetStorefront = (tenantId: string) =>
  request(`${base(tenantId)}/storefront`, { schema: StorefrontPublicResponseSchema }).then(
    (res) => res.config,
  );

export const publicGetAnnouncement = (tenantId: string) =>
  request(`${base(tenantId)}/announcement`, { schema: AnnouncementSchema });

export const publicListSchemas = (tenantId: string) =>
  request(`${base(tenantId)}/schemas`, { schema: SchemaListSchema });

// ---------------------------------------------------------------- a stranger's cart
// Every one of these carries the ticket; the engine's GuestGuard is what
// turns it into a principal, and the same cart, checkout and order services
// answer as they do for a signed-in buyer.

export const guestMint = (tenantId: string) =>
  request(`${base(tenantId)}/guest`, { method: 'POST', schema: GuestTokenResponseSchema }).then(
    (res) => res.guest,
  );

export const guestGetCart = (tenantId: string, guest: string) =>
  request(`${base(tenantId)}/cart`, { schema: CartResponseSchema, guest });

export const guestPutCartLine = (tenantId: string, guest: string, productId: string, qty: number) =>
  request(`${base(tenantId)}/cart/lines/${productId}`, {
    method: 'PUT',
    body: { qty },
    schema: CartResponseSchema,
    guest,
  });

export const guestClearCart = (tenantId: string, guest: string) =>
  request(`${base(tenantId)}/cart`, { method: 'DELETE', schema: CartResponseSchema, guest });

export const guestCheckout = (
  tenantId: string,
  guest: string,
  body: GuestCheckoutRequest,
  idempotencyKey: string,
) =>
  request(`${base(tenantId)}/checkout`, {
    method: 'POST',
    body,
    schema: OrderResponseSchema,
    idempotencyKey,
    guest,
  });

export const guestGetOrder = (tenantId: string, guest: string, id: string) =>
  request(`${base(tenantId)}/orders/${id}`, { schema: OrderResponseSchema, guest });

/**
 * The email is the lookup key, sent when the shopper reached this order by
 * looking it up rather than by holding the ticket they checked out with. A
 * ticket belongs to a browser; the order outlives it.
 */
export const guestPayOrder = (
  tenantId: string,
  guest: string,
  id: string,
  card: Card,
  email?: string,
) =>
  request(`${base(tenantId)}/orders/${id}/pay`, {
    method: 'POST',
    body: email ? { card, email } : { card },
    schema: OrderResponseSchema,
    guest,
  });

/** A guest giving back the stock their unpaid order is holding. */
export const guestCancelOrder = (tenantId: string, guest: string, id: string, email?: string) =>
  request(`${base(tenantId)}/orders/${id}/cancel`, {
    method: 'POST',
    body: email ? { email } : {},
    schema: OrderResponseSchema,
    guest,
  });

/** No ticket: the guest is back in a fresh browser with the id and the email they gave. */
export const lookupOrder = (tenantId: string, orderId: string, email: string) =>
  request(`${base(tenantId)}/orders/lookup`, {
    method: 'POST',
    body: { orderId, email },
    schema: OrderResponseSchema,
  });

/** A stranger booking a class on the shop's own route, on their ticket. */
export const guestBook = (
  tenantId: string,
  guest: string,
  body: CreateBooking & { email: string; name: string; phone: string },
  idempotencyKey: string,
) =>
  request(`${base(tenantId)}/bookings`, {
    method: 'POST',
    body,
    schema: BookingResponseSchema,
    guest,
    idempotencyKey,
  });

export const guestGetBooking = (tenantId: string, guest: string, id: string) =>
  request(`${base(tenantId)}/bookings/${id}`, { schema: BookingResponseSchema, guest });

export const publicGetContact = (tenantId: string) =>
  request(`${base(tenantId)}/contact`, { schema: ShopContactSchema });

export const publicGetDepositPolicy = (tenantId: string) =>
  request(`${base(tenantId)}/deposit`, { schema: DepositPolicySchema });

/**
 * Everything this address has bought at this shop. The email is the
 * credential, exactly as it is for a single order lookup.
 */
export const guestOrderHistory = (tenantId: string, email: string) =>
  request(`${base(tenantId)}/orders/history`, {
    method: 'POST',
    body: { email },
    schema: OrderResponseSchema.array(),
  });
