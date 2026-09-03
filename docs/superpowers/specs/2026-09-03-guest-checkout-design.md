# Guest checkout — design

**Date:** 2026-09-03 · **Theme:** A (public storefront), third slice
**Follows:** `2026-09-03-public-storefront-design.md` (a stranger browses),
the SEO slice landed the same day (a crawler reads).
**Status:** designed, not built. The decisions below are the author's; the
owner has not reviewed them. Where a decision could go another way it says so.

## Outcome

A stranger on `acme.localhost:33002` puts a mug in a cart, pays for it, and
gets an order they can find again — with no account, no password, no sign-in
page. If they later sign in, the cart they built as a stranger comes with them.

## What exists

- The cart is server-side, one record per `(tenant, userId)` at
  `cartSk(userId)`, and every cart route needs a JWT.
- Checkout (`POST /checkout`) reads that cart, creates an `awaiting_payment`
  order owned by the JWT's user, clears the cart; `POST /orders/:id/pay`
  charges it. Both are `Idempotency-Key`-gated.
- `@Public()` routes run under `{ role: 'public', userId: 'anonymous' }`. A
  shared `anonymous` user id is exactly one cart for every stranger in the
  world; it cannot be the guest identity.

## Design

### 1. A guest is a signed id, minted by the engine

`POST /shops/:tenantId/guest` (public) returns `{ guest: "<ulid>.<hmac>" }`.
The HMAC is over `tenantId + ulid` with `GUEST_SECRET` (engine env, required
in compose, refused empty). The token is opaque to the client and bound to
the tenant it was minted for: a token from `acme` presented on `globex`
fails verification, so one stranger's cart cannot follow them across shops.

The client sends it as `X-Guest: <token>` on the guest routes below. A guard
(`GuestGuard`) verifies the HMAC and sets the principal to
`{ role: 'guest', userId: 'guest:<ulid>' }`. Verification failure is a 401
with problem type `invalid-guest`, never a 404: there is nothing to hide.

*Why HMAC and not a JWT:* no claims, no expiry to reason about, no library
surface; a guest id is a coat-check ticket. *Why the engine mints it:* one
secret, in one process; the web app never signs anything.

*Storage in the browser:* `localStorage` under `marketplace.guest.<tenant>`,
read by the cart context on a shop host when there is no session. A cookie
would be the conventional choice; it would also cross into the platform host
and the cockpit, and every fetch here is already a same-origin XHR with a
header, so localStorage keeps the guest where it belongs.

### 2. Guest cart, guest checkout, guest pay

Under `/shops/:tenantId`, guarded by `GuestGuard`, mirroring the token
routes one for one:

| Route | Does |
|---|---|
| `GET /shops/:t/cart` | `CartService.get()` for `guest:<ulid>` |
| `PUT /shops/:t/cart/lines/:productId` | same, `PutCartLine` |
| `DELETE /shops/:t/cart` | same |
| `POST /shops/:t/checkout` | `CheckoutRequest` **plus `email`**; creates the order owned by `guest:<ulid>` with `guestEmail` stored on the record |
| `POST /shops/:t/orders/:id/pay` | `OrderPaymentService.pay` with the guest principal |
| `GET /shops/:t/orders/:id` | the guest's own order, 404 otherwise |

`CartService`, `CheckoutService` and `OrderPaymentService` already key
everything on `currentPrincipal().userId`; the guest principal makes them
work unchanged. `ShopScope` (the public resolver) already builds the tenant
partition from the path. The one schema change is `guestEmail` on
`OrderRecord`/`OrderResponse`, optional, present only on guest orders.

Products in the cart are resolved against the live product exactly as today,
so a draft product cannot be carted by a stranger any more than a shopper.

### 3. Finding the order again

`POST /shops/:t/orders/lookup` `{ orderId, email }` (public, no guest token):
returns the order when both match, 404 otherwise, with the same body for
"no such order" and "wrong email". Rate-limited like login would be: 10 per
minute per IP through the existing hardening middleware. The confirmation
page shows the order id and says "keep this with your email to find it
again"; there is no email sent, because Theme F (notifications) is not built
and this slice will not pretend it is.

### 4. Promotion on sign-in

`POST /cart/merge` `{ guest: "<token>" }` (JWT route): verifies the token for
the JWT's tenant, adds the guest cart's lines to the user's cart (quantities
summed, capped at `MAX_QUANTITY`, lines beyond `MAX_CART_LINES` dropped
newest-last), deletes the guest cart. The web app calls it once after login
when a guest token exists, then forgets the token. Guest **orders** are not
promoted: they belong to the ticket, and the ticket stays in the browser
that placed them. Customers as an identity (the next slice) is where orders
attach to a person.

### 5. What the web app does

- `CartProvider` on a shop host with no session: mint a guest (once, on first
  `add`), keep it in localStorage, use the guest routes. The header's Cart
  works for a stranger; `/cart` is no longer a protected route on a shop host.
- `/cart` for a stranger asks for an email beside the address. Checkout
  posts to the guest checkout, then `/orders/:id/pay` uses the guest pay
  route, then `/orders/:id` renders the guest's order with a "find this
  order later" note.
- `/orders` for a stranger is a lookup form (id + email), not a list.
- The login page, after a successful sign-in on a shop host, merges the guest
  cart and clears the token.
- The platform host is unchanged: no guest anything on `localhost:33002`.

### 6. Not in this slice

- Email of any kind (Theme F).
- A real payment provider (Theme C.5); the simulated card stays.
- Guest bookings. Events keep asking for a sign-in to book; a booking is a
  named place at a table in a way a mug is not, and the customer identity
  slice is the right time.
- Cart expiry. Guest carts are records with no TTL; a sweep is a one-liner
  once there is a scheduled job anywhere in the stack.

## Tests

- Engine unit: guest token mint/verify (tenant-bound, tamper-refused);
  merge arithmetic (sum, cap, drop).
- Engine e2e: a guest carts, checks out with an email, pays, reads the order;
  another guest token cannot read it; lookup answers with the right email and
  404s with the wrong one; a token from another tenant is 401 on this one;
  merge after sign-in moves the lines.
- Web unit: cart context picks guest routes on a shop host with no session
  and token routes otherwise; the cart page shows the email field only to a
  stranger.
- Journeys: "a stranger buys a mug on the shop host without signing in";
  "a stranger who then signs in keeps the cart".

## Sizing

Engine: guest module (token, guard, controller) ~1 day; guest email on the
order and lookup ~half a day; merge ~half a day. Web: cart context, cart
page, lookup page, login merge ~1.5 days. Journeys and e2e ~half a day.
Roughly four working days, in line with the roadmap's phase 1 estimate.
