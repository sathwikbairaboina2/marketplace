# Server-Side Cart and Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-buyer server-side cart and a checkout flow that creates orders in an `awaiting_payment` gate, paid through a fake card provider with Stripe-style magic numbers.

**Architecture:** New `cart/` and `payments/` engine modules mirroring the `settings/`/`storefront/` module shape; orders gain an `awaiting_payment` status that sits before the copied stage list; a new `POST /checkout` builds the order from the server cart while legacy `POST /orders` stays untouched. The web `CartProvider` keeps its interface but backs onto the API.

**Tech Stack:** NestJS, DynamoDB single table, zod contracts, Next.js 15 + antd, vitest/jest/playwright.

**Spec:** `docs/superpowers/specs/2026-08-20-cart-checkout-design.md`

## Global Constraints

- No floats for money — everything integer minor units; bounds in `packages/contracts/src/common.ts`.
- Every error is an RFC 9457 problem; new codes MUST be added to the `ProblemType` union in `apps/engine/src/common/problem.ts` before use.
- Ownership failures answer 404, never 403.
- Admin-only routes carry both `@Roles('admin')` and a service check.
- Nothing may be inserted into an order transaction ahead of the line-item updates (`explainFailure` maps by position).
- Race tests assert on outcomes, not error classes.
- Never use `window.confirm`/`alert`/`prompt`; antd `Popconfirm` only.
- Card numbers are never persisted (only `last4`) and never logged.
- Verify UI by rendering and looking (screenshots), not only by tests.
- Type checking is `build`: run `pnpm --filter @marketplace/engine build` / `pnpm --filter @marketplace/web build` before believing a change done.
- Test runs: repo-wide is `npx turbo run test --concurrency=1`; re-run a red suite alone before believing it.

---

### Task 1: Cart and payment contracts

**Files:**
- Create: `packages/contracts/src/cart.ts`
- Create: `packages/contracts/src/cart.test.ts`
- Create: `packages/contracts/src/payment.ts`
- Create: `packages/contracts/src/payment.test.ts`
- Modify: `packages/contracts/src/order.ts` (status enum, payment field, nullable stage)
- Modify: `packages/contracts/src/index.ts` (export the new modules)

**Interfaces:**
- Produces: `CartLineSchema`, `ResolvedCartLineSchema`, `CartResponseSchema`, `PutCartLineSchema`, `MAX_CART_LINES` (50); `CardSchema`, `PayRequestSchema`, `PaymentSchema`, `luhnValid(digits: string): boolean`, `normalizeCardNumber(raw: string): string`; `OrderStatusSchema` gains `'awaiting_payment'`; `OrderResponse.payment?: Payment`; `OrderResponse.currentStageId: string | null`.

- [ ] **Step 1: Write the failing tests**

`packages/contracts/src/cart.test.ts` (match the existing describe/it style in `storefront.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import {
  CartLineSchema,
  CartResponseSchema,
  MAX_CART_LINES,
  PutCartLineSchema,
} from './cart';

describe('CartLineSchema', () => {
  it('accepts a productId and positive quantity', () => {
    expect(
      CartLineSchema.parse({ productId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', qty: 2 }),
    ).toEqual({ productId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', qty: 2 });
  });

  it('rejects zero and negative quantities', () => {
    expect(CartLineSchema.safeParse({ productId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', qty: 0 }).success).toBe(false);
    expect(CartLineSchema.safeParse({ productId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', qty: -1 }).success).toBe(false);
  });

  it('rejects a non-ULID productId', () => {
    expect(CartLineSchema.safeParse({ productId: 'nope', qty: 1 }).success).toBe(false);
  });
});

describe('PutCartLineSchema', () => {
  it('accepts qty 0 (removal)', () => {
    expect(PutCartLineSchema.parse({ qty: 0 })).toEqual({ qty: 0 });
  });
});

describe('CartResponseSchema', () => {
  const line = {
    productId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    qty: 2,
    name: 'Mug',
    unitPriceMinor: 1200,
    currency: 'USD',
    image: null,
    stock: 5,
    unavailable: false,
  };

  it('round-trips a resolved cart', () => {
    const cart = { lines: [line], totalMinor: 2400 };
    expect(CartResponseSchema.parse(cart)).toEqual(cart);
  });

  it('caps the number of lines', () => {
    const lines = Array.from({ length: MAX_CART_LINES + 1 }, (_, i) => ({
      ...line,
      productId: `01ARZ3NDEKTSV4RRFFQ69G5F${String(i).padStart(2, '0')}`.slice(0, 26),
    }));
    expect(CartResponseSchema.safeParse({ lines, totalMinor: 0 }).success).toBe(false);
  });
});
```

`packages/contracts/src/payment.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CardSchema, luhnValid, normalizeCardNumber, PaymentSchema, PayRequestSchema } from './payment';

describe('normalizeCardNumber', () => {
  it('strips spaces and dashes', () => {
    expect(normalizeCardNumber('4242 4242-4242 4242')).toBe('4242424242424242');
  });
});

describe('luhnValid', () => {
  it('accepts the magic numbers', () => {
    expect(luhnValid('4242424242424242')).toBe(true);
    expect(luhnValid('4000000000000002')).toBe(true);
    expect(luhnValid('4000000000009995')).toBe(true);
  });
  it('rejects a digit-swapped number', () => {
    expect(luhnValid('4242424242424241')).toBe(false);
  });
});

describe('CardSchema', () => {
  const card = { number: '4242 4242 4242 4242', expMonth: 12, expYear: 2030, cvc: '123' };

  it('accepts a well-formed card and normalizes the number', () => {
    expect(CardSchema.parse(card).number).toBe('4242424242424242');
  });
  it('rejects a Luhn-invalid number', () => {
    expect(CardSchema.safeParse({ ...card, number: '4242424242424241' }).success).toBe(false);
  });
  it('rejects an out-of-range month', () => {
    expect(CardSchema.safeParse({ ...card, expMonth: 13 }).success).toBe(false);
  });
  it('rejects a short cvc', () => {
    expect(CardSchema.safeParse({ ...card, cvc: '12' }).success).toBe(false);
  });
});

describe('PaymentSchema', () => {
  it('round-trips a stored payment (last4 only, never the number)', () => {
    const payment = { id: 'pay_1', last4: '4242', amountMinor: 2400, at: '2026-08-20T12:00:00.000Z' };
    expect(PaymentSchema.parse(payment)).toEqual(payment);
    expect('number' in PaymentSchema.shape).toBe(false);
  });
});

describe('PayRequestSchema', () => {
  it('is just a card envelope', () => {
    const parsed = PayRequestSchema.parse({
      card: { number: '4242424242424242', expMonth: 1, expYear: 2031, cvc: '999' },
    });
    expect(parsed.card.number).toBe('4242424242424242');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @marketplace/contracts test -- cart` and `-- payment`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement**

`packages/contracts/src/cart.ts`:

```ts
import { z } from 'zod';
import { CurrencySchema, MinorAmountSchema, QuantitySchema, StockSchema, UlidSchema } from './common';

export const MAX_CART_LINES = 50;

/** What the client sends: identity and quantity only. The server owns prices. */
export const CartLineSchema = z.object({
  productId: UlidSchema,
  qty: QuantitySchema,
});
export type CartLine = z.infer<typeof CartLineSchema>;

/** Body of PUT /cart/lines/:productId. qty 0 removes the line. */
export const PutCartLineSchema = z.object({
  qty: z.number().int().nonnegative().max(QuantitySchema.maxValue ?? 10_000),
});
export type PutCartLine = z.infer<typeof PutCartLineSchema>;

/** A line as the server returns it: resolved against the live product. */
export const ResolvedCartLineSchema = z.object({
  productId: UlidSchema,
  qty: QuantitySchema,
  name: z.string(),
  unitPriceMinor: MinorAmountSchema,
  currency: CurrencySchema,
  image: z.string().nullable(),
  stock: StockSchema,
  /** True when the product is archived/inactive or gone: rendered struck-through, refused at checkout. */
  unavailable: z.boolean(),
});
export type ResolvedCartLine = z.infer<typeof ResolvedCartLineSchema>;

export const CartResponseSchema = z.object({
  lines: z.array(ResolvedCartLineSchema).max(MAX_CART_LINES),
  /** Server-computed sum over available lines, integer minor units. */
  totalMinor: z.number().int().nonnegative(),
});
export type CartResponse = z.infer<typeof CartResponseSchema>;
```

(If `QuantitySchema.maxValue` is not available in the zod version in use, import `MAX_QUANTITY` from `./common` and use it directly: `z.number().int().nonnegative().max(MAX_QUANTITY)`.)

`packages/contracts/src/payment.ts`:

```ts
import { z } from 'zod';
import { IsoDateTimeSchema, MinorAmountSchema } from './common';

export const normalizeCardNumber = (raw: string): string => raw.replace(/[\s-]/g, '');

/** Standard Luhn checksum over a digit string. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Magic numbers, Stripe test-card style. The provider selects the outcome;
 * the schema only guarantees the number is well-formed.
 */
export const MAGIC_CARD = {
  success: '4242424242424242',
  declined: '4000000000000002',
  insufficientFunds: '4000000000009995',
} as const;

export const CardSchema = z.object({
  number: z
    .string()
    .transform(normalizeCardNumber)
    .refine(luhnValid, 'not a valid card number'),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(2020).max(2100),
  cvc: z.string().regex(/^\d{3,4}$/, 'must be 3 or 4 digits'),
});
export type Card = z.infer<typeof CardSchema>;

export const PayRequestSchema = z.object({ card: CardSchema });
export type PayRequest = z.infer<typeof PayRequestSchema>;

/** What is stored on the order. Deliberately no card number field. */
export const PaymentSchema = z.object({
  id: z.string(),
  last4: z.string().regex(/^\d{4}$/),
  amountMinor: MinorAmountSchema,
  at: IsoDateTimeSchema,
});
export type Payment = z.infer<typeof PaymentSchema>;
```

`packages/contracts/src/order.ts` changes:
- `OrderStatusSchema`: `z.enum(['pending', 'confirmed', 'cancelled', 'awaiting_payment'])`.
- `OrderResponseSchema`: `currentStageId` becomes `.nullable()` (null exactly while `awaiting_payment`); add `payment: PaymentSchema.optional()`.
- Import `PaymentSchema` from `./payment`.

`packages/contracts/src/index.ts`: add `export * from './cart';` and `export * from './payment';`.

- [ ] **Step 4: Run**

`pnpm --filter @marketplace/contracts test` → PASS (including the existing order tests — if an order test pins the exact status enum, extend it to include `awaiting_payment`).
`pnpm --filter @marketplace/contracts build` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src
git commit -m "feat(contracts): cart, card and payment schemas; awaiting_payment order status"
```

---

### Task 2: Engine cart service

**Files:**
- Modify: `apps/engine/src/persistence/keys.ts` (add `cartSk`)
- Create: `apps/engine/src/cart/cart.service.ts`
- Create: `apps/engine/src/cart/cart.service.test.ts`

**Interfaces:**
- Consumes: `DynamoRepository` (`get<T>(sk)`, `put(sk, item)` — read `apps/engine/src/persistence/dynamo.repository.ts` first to confirm exact signatures; `apps/engine/src/settings/settings.service.ts` is the model to copy for repo/principal stubbing), `currentPrincipal()` from `../common/tenant-context`, `entitySk` from `../persistence/keys`, contracts from Task 1.
- Produces: `CartService` with `get(): Promise<CartResponse>`, `putLine(productId: string, qty: number): Promise<CartResponse>`, `clear(): Promise<CartResponse>`, and `rawLines(): Promise<CartLine[]>` (used by checkout in Task 5).

- [ ] **Step 1: Add the key**

In `apps/engine/src/persistence/keys.ts`, beside `settingsSk`:

```ts
/** One cart per user per tenant. The item holds every line. */
export function cartSk(userId: string): string {
  return `CART#${userId}`;
}
```

- [ ] **Step 2: Write failing tests**

`apps/engine/src/cart/cart.service.test.ts`, stubbing repo and principal the way `settings.service.test.ts` does. Cover:

1. `get` on a user with no cart item returns `{ lines: [], totalMinor: 0 }`.
2. `putLine` on an empty cart writes one stored line `{ productId, qty }` and returns the resolved cart (name/price from the stubbed product).
3. `putLine` for an already-present product replaces its qty (not adds).
4. `putLine` with `qty: 0` removes the line.
5. `putLine` for a product that does not exist in the tenant throws a 404 problem (`not-found`).
6. `putLine` for an inactive/archived product throws `invalid-request` 422.
7. `putLine` past `MAX_CART_LINES` distinct products throws `invalid-request` 422 with the cap in the detail.
8. `get` resolves each line against the live product; a line whose product is now archived or deleted comes back `unavailable: true` with its last-known name (or `'(no longer available)'` when the product is gone) and is excluded from `totalMinor`.
9. `totalMinor` is `sum(unitPriceMinor * qty)` over available lines.
10. `clear` empties the cart.

Test sketch for case 8 (write the rest in the same shape):

```ts
it('flags a line whose product was archived and excludes it from the total', async () => {
  repo.get.mockImplementation(async (sk: string) => {
    if (sk === cartSk('user-1')) {
      return { lines: [{ productId: P1, qty: 2 }, { productId: P2, qty: 1 }] };
    }
    if (sk === entitySk('Product', P1)) return product({ id: P1, priceMinor: 500, status: 'active' });
    if (sk === entitySk('Product', P2)) return product({ id: P2, status: 'archived' });
    return null;
  });
  const cart = await service.get();
  expect(cart.lines.find((l) => l.productId === P2)?.unavailable).toBe(true);
  expect(cart.totalMinor).toBe(1000);
});
```

- [ ] **Step 3: Run to verify failure** — `pnpm --filter @marketplace/engine test -- cart.service` → FAIL.

- [ ] **Step 4: Implement `CartService`**

```ts
import { Injectable } from '@nestjs/common';
import {
  CartLine,
  CartResponse,
  MAX_CART_LINES,
  ProductRecord,
  ResolvedCartLine,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { cartSk, entitySk } from '../persistence/keys';
import { currentPrincipal } from '../common/tenant-context';
import { ProblemException } from '../common/problem';

interface CartItem {
  lines: CartLine[];
}

@Injectable()
export class CartService {
  constructor(private readonly repo: DynamoRepository) {}

  private sk(): string {
    return cartSk(currentPrincipal().userId);
  }

  /** The stored lines, unresolved. Checkout consumes these. */
  async rawLines(): Promise<CartLine[]> {
    const item = await this.repo.get<CartItem>(this.sk());
    return item?.lines ?? [];
  }

  async get(): Promise<CartResponse> {
    return this.resolve(await this.rawLines());
  }

  async putLine(productId: string, qty: number): Promise<CartResponse> {
    const lines = await this.rawLines();
    const rest = lines.filter((l) => l.productId !== productId);

    if (qty === 0) {
      await this.repo.put(this.sk(), { lines: rest });
      return this.resolve(rest);
    }

    // Adding or changing a line requires a live product; lines already in the
    // cart survive archival (they surface as unavailable on read instead).
    const product = await this.repo.get<ProductRecord>(entitySk('Product', productId));
    if (!product) throw new ProblemException('not-found', 404, 'Product not found');
    if (product.status !== 'active') {
      throw new ProblemException(
        'invalid-request', 422, 'Product not available',
        `product ${productId} is ${product.status}`, { productId },
      );
    }

    const next = [...rest, { productId, qty }];
    if (next.length > MAX_CART_LINES) {
      throw new ProblemException(
        'invalid-request', 422, 'Cart is full',
        `a cart holds at most ${MAX_CART_LINES} distinct products`, { max: MAX_CART_LINES },
      );
    }
    await this.repo.put(this.sk(), { lines: next });
    return this.resolve(next);
  }

  async clear(): Promise<CartResponse> {
    await this.repo.put(this.sk(), { lines: [] });
    return { lines: [], totalMinor: 0 };
  }

  private async resolve(lines: CartLine[]): Promise<CartResponse> {
    const resolved: ResolvedCartLine[] = await Promise.all(
      lines.map(async (line) => {
        const product = await this.repo.get<ProductRecord>(entitySk('Product', line.productId));
        if (!product || product.status !== 'active') {
          return {
            productId: line.productId,
            qty: line.qty,
            name: product?.name ?? '(no longer available)',
            unitPriceMinor: product?.priceMinor ?? 0,
            currency: product?.currency ?? 'USD',
            image: product?.images?.[0] ?? null,
            stock: 0,
            unavailable: true,
          };
        }
        return {
          productId: line.productId,
          qty: line.qty,
          name: product.name,
          unitPriceMinor: product.priceMinor,
          currency: product.currency,
          image: product.images?.[0] ?? null,
          stock: product.stock,
          unavailable: false,
        };
      }),
    );
    const totalMinor = resolved
      .filter((l) => !l.unavailable)
      .reduce((sum, l) => sum + l.unitPriceMinor * l.qty, 0);
    return { lines: resolved, totalMinor };
  }
}
```

Adjust the `ProductRecord` field access (`images`) to whatever the real product record calls it — read `packages/contracts/src/product.ts` first and use its exact field.

- [ ] **Step 5: Run** — `pnpm --filter @marketplace/engine test -- cart.service` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/engine/src/persistence/keys.ts apps/engine/src/cart
git commit -m "feat(engine): buyer cart service over the single table"
```

---

### Task 3: Engine cart controller, module, e2e

**Files:**
- Create: `apps/engine/src/cart/cart.controller.ts`
- Create: `apps/engine/src/cart/cart.module.ts`
- Modify: `apps/engine/src/app.module.ts` (import `CartModule`)
- Create: `apps/engine/test/e2e/cart.e2e.test.ts`

**Interfaces:**
- Consumes: `CartService` (Task 2), `ZodBody` from `../common/zod-validation.pipe`, `PutCartLineSchema` from contracts.
- Produces: routes `GET /api/v1/cart`, `PUT /api/v1/cart/lines/:productId`, `DELETE /api/v1/cart`.

- [ ] **Step 1: Controller + module**

```ts
import { Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { CartResponse, PutCartLine, PutCartLineSchema } from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { CartService } from './cart.service';

/** Buyer-scoped: every route acts on the calling user's own cart. No roles decorator — any signed-in user has a cart. */
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(): Promise<CartResponse> {
    return this.cart.get();
  }

  @Put('lines/:productId')
  putLine(
    @Param('productId') productId: string,
    @ZodBody(PutCartLineSchema) body: PutCartLine,
  ): Promise<CartResponse> {
    return this.cart.putLine(productId, body.qty);
  }

  @Delete()
  clear(): Promise<CartResponse> {
    return this.cart.clear();
  }
}
```

Module mirrors `settings.module.ts` (providers `[CartService]`, controllers `[CartController]`, exports `[CartService]` — checkout imports it in Task 5). Register in `app.module.ts`.

- [ ] **Step 2: Build** — `pnpm --filter @marketplace/engine build` → clean.

- [ ] **Step 3: e2e suite**

`apps/engine/test/e2e/cart.e2e.test.ts`, modeled on `storefront.e2e.test.ts` for setup/auth helpers. Against the running stack:

1. Fresh buyer: `GET /cart` → `{ lines: [], totalMinor: 0 }`.
2. Admin creates a product; buyer `PUT /cart/lines/:id {qty: 2}` → cart with one resolved line, correct `totalMinor`.
3. `PUT` same product `{qty: 5}` → qty replaced, not added.
4. `PUT {qty: 0}` → line gone.
5. `PUT` for a fabricated ULID → 404 problem.
6. Buyer B's `GET /cart` does not see buyer A's lines (same tenant, different users).
7. `DELETE /cart` → empty.

- [ ] **Step 4: Run it** — stack up (`pnpm docker:up` if not running), rebuild engine container (`docker compose -f docker/docker-compose.yml up -d --build --force-recreate engine`), then `pnpm --filter @marketplace/engine test:e2e -- cart` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/engine/src/cart apps/engine/src/app.module.ts apps/engine/test/e2e/cart.e2e.test.ts
git commit -m "feat(engine): cart routes with per-line writes and e2e coverage"
```

---

### Task 4: Payments module — provider interface and fake card provider

**Files:**
- Create: `apps/engine/src/payments/payment.provider.ts`
- Create: `apps/engine/src/payments/fake-card.provider.ts`
- Create: `apps/engine/src/payments/fake-card.provider.test.ts`
- Create: `apps/engine/src/payments/payments.module.ts`
- Modify: `apps/engine/src/common/problem.ts` (new problem types)

**Interfaces:**
- Produces: `PAYMENT_PROVIDER` injection token; `PaymentProvider` interface `charge(input: ChargeInput): Promise<ChargeResult>` where `ChargeInput = { orderId: string; amountMinor: number; currency: string; card: Card }` and `ChargeResult = { paymentId: string; last4: string }` (a failed charge THROWS a `ProblemException`, it does not return a status); `FakeCardProvider`; problem types `'payment-declined'`, `'insufficient-funds'`, `'order-not-payable'`.

- [ ] **Step 1: Add problem types**

In the `ProblemType` union in `apps/engine/src/common/problem.ts`:

```ts
  // The card was refused by the provider. Retry with another card.
  | 'payment-declined'
  // The card was accepted but the account cannot cover the amount.
  | 'insufficient-funds'
  // Pay was called on an order that is not awaiting payment.
  | 'order-not-payable'
```

- [ ] **Step 2: Write failing tests**

`fake-card.provider.test.ts`:

```ts
const card = (number: string) => ({ number, expMonth: 12, expYear: 2030, cvc: '123' });
const input = (number: string) => ({
  orderId: 'o-1', amountMinor: 2400, currency: 'USD', card: card(number),
});

it('charges the success number and returns last4', async () => {
  const result = await provider.charge(input('4242424242424242'));
  expect(result.last4).toBe('4242');
  expect(result.paymentId).toMatch(/^fake_/);
});

it('declines 4000000000000002 with a payment-declined problem', async () => {
  await expect(provider.charge(input('4000000000000002'))).rejects.toMatchObject({
    problem: expect.objectContaining({ type: expect.stringContaining('payment-declined'), status: 402 }),
  });
});

it('refuses 4000000000009995 with insufficient-funds', async () => {
  await expect(provider.charge(input('4000000000009995'))).rejects.toMatchObject({
    problem: expect.objectContaining({ type: expect.stringContaining('insufficient-funds'), status: 402 }),
  });
});

it('succeeds for any other Luhn-valid number', async () => {
  await expect(provider.charge(input('4111111111111111'))).resolves.toMatchObject({ last4: '1111' });
});

it('never includes the card number in the result', async () => {
  const result = await provider.charge(input('4242424242424242'));
  expect(JSON.stringify(result)).not.toContain('4242424242424242');
});
```

- [ ] **Step 3: Run to verify failure** — `pnpm --filter @marketplace/engine test -- fake-card` → FAIL.

- [ ] **Step 4: Implement**

`payment.provider.ts`:

```ts
import { Card } from '@marketplace/contracts';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface ChargeInput {
  orderId: string;
  amountMinor: number;
  currency: string;
  card: Card;
}

export interface ChargeResult {
  paymentId: string;
  last4: string;
}

/** A failed charge throws a ProblemException; success returns the receipt. */
export interface PaymentProvider {
  charge(input: ChargeInput): Promise<ChargeResult>;
}
```

`fake-card.provider.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { MAGIC_CARD } from '@marketplace/contracts';
import { randomUUID } from 'node:crypto';
import { ProblemException } from '../common/problem';
import { ChargeInput, ChargeResult, PaymentProvider } from './payment.provider';

/**
 * Deterministic, offline, Stripe-shaped. The card number selects the outcome;
 * format validity is the schema's job (Task 1), so anything arriving here is
 * already Luhn-valid. 402 Payment Required for both refusal modes.
 */
@Injectable()
export class FakeCardProvider implements PaymentProvider {
  async charge(input: ChargeInput): Promise<ChargeResult> {
    const number = input.card.number;
    if (number === MAGIC_CARD.declined) {
      throw new ProblemException('payment-declined', 402, 'Card declined',
        'the card was declined; try a different card');
    }
    if (number === MAGIC_CARD.insufficientFunds) {
      throw new ProblemException('insufficient-funds', 402, 'Insufficient funds',
        'the card cannot cover this amount; try a different card');
    }
    return { paymentId: `fake_${randomUUID()}`, last4: number.slice(-4) };
  }
}
```

`payments.module.ts` provides `{ provide: PAYMENT_PROVIDER, useClass: FakeCardProvider }` and exports `PAYMENT_PROVIDER`.

- [ ] **Step 5: Run** — `pnpm --filter @marketplace/engine test -- fake-card` → PASS. `pnpm --filter @marketplace/engine build` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/engine/src/payments apps/engine/src/common/problem.ts
git commit -m "feat(engine): payment provider interface with deterministic fake card provider"
```

---

### Task 5: Orders — awaiting_payment gate, pay, checkout

**Files:**
- Modify: `apps/engine/src/orders/orders.service.ts` (`create` option, `pay`, `cancel` for unpaid, `toResponse` null stage)
- Modify: `apps/engine/src/orders/orders.controller.ts` (add `POST /orders/:id/pay`)
- Create: `apps/engine/src/checkout/checkout.service.ts`
- Create: `apps/engine/src/checkout/checkout.controller.ts`
- Create: `apps/engine/src/checkout/checkout.module.ts`
- Create: `apps/engine/src/checkout/checkout.service.test.ts`
- Modify: `apps/engine/src/orders/orders.service.test.ts` (if present — extend; otherwise the new behavior is covered by the checkout tests and e2e)
- Modify: `apps/engine/src/app.module.ts`, `apps/engine/src/orders/orders.module.ts` (wire `PaymentsModule`, export what checkout needs)

**Interfaces:**
- Consumes: `CartService.rawLines()`/`clear()` (Task 2), `PAYMENT_PROVIDER` (Task 4), existing `OrdersService.create`.
- Produces: `OrdersService.create(input, opts?: { awaitPayment?: boolean })`; `OrdersService.pay(id: string, card: Card): Promise<OrderResponse>`; `CheckoutService.checkout(input: CheckoutInput): Promise<OrderResponse>` where `CheckoutInput = { currency: string; shippingAddress: CreateOrder['shippingAddress']; attributes?: CreateOrder['attributes'] }`; routes `POST /api/v1/checkout`, `POST /api/v1/orders/:id/pay`. Contracts: add `CheckoutRequestSchema` to `packages/contracts/src/cart.ts` mirroring `CreateOrderSchema` minus `items` (copy its currency/shippingAddress/attributes fields exactly from `order.ts`).

- [ ] **Step 1: `toResponse` must not clobber the null stage**

In `orders.service.ts`, the backfill currently reads `currentStageId: rest.currentStageId ?? DEFAULT_PIPELINE.stages[0].id`. An `awaiting_payment` order legitimately stores `currentStageId: null`. Change the backfill to only apply to legacy orders (which predate the field entirely):

```ts
    currentStageId:
      rest.currentStageId !== undefined ? rest.currentStageId : DEFAULT_PIPELINE.stages[0].id,
```

- [ ] **Step 2: `create` gains the gate option**

`async create(input: CreateOrder, opts: { awaitPayment?: boolean } = {})`. Two lines change in the record it builds:

```ts
      status: opts.awaitPayment ? 'awaiting_payment' : 'confirmed',
      currentStageId: opts.awaitPayment ? null : pipeline.stages[0].id,
```

Everything else — validation, transaction, ordering, `explainFailure` — is untouched. Legacy `POST /orders` keeps calling `create(input)`.

- [ ] **Step 3: `pay`**

```ts
  async pay(id: string, card: Card): Promise<OrderResponse> {
    // Buyer-owned, same 404-not-403 shape as get/cancel.
    const found = await this.repo.get<OrderRecord>(entitySk('Order', id));
    if (!found || found.userId !== currentPrincipal().userId) {
      throw new ProblemException('not-found', 404, 'Order not found');
    }
    const current = toResponse(found);

    if (current.status !== 'awaiting_payment') {
      throw new ProblemException(
        'order-not-payable', 409, 'Order is not awaiting payment',
        `order ${id} is ${current.status}`,
      );
    }

    // Amount comes from the order the transaction wrote — never from the client.
    const receipt = await this.provider.charge({
      orderId: id,
      amountMinor: current.totalAmountMinor,
      currency: current.currency,
      card,
    });

    const now = new Date().toISOString();
    const payment: Payment = {
      id: receipt.paymentId,
      last4: receipt.last4,
      amountMinor: current.totalAmountMinor,
      at: now,
    };
    const firstStageId = current.stages[0].id;

    try {
      await this.repo.transactWrite([
        {
          Update: {
            TableName: this.repo.tableName,
            Key: this.repo.key(entitySk('Order', id)),
            UpdateExpression:
              'SET #status = :confirmed, #currentStageId = :stage, #stageEnteredAt = :now, #payment = :payment',
            // The status condition is the double-pay and pay-after-cancel guard:
            // whichever write lands second fails its condition.
            ConditionExpression: '#status = :awaiting',
            ExpressionAttributeNames: {
              '#status': 'status',
              '#currentStageId': 'currentStageId',
              '#stageEnteredAt': 'stageEnteredAt',
              '#payment': 'payment',
            },
            ExpressionAttributeValues: {
              ':confirmed': 'confirmed',
              ':stage': firstStageId,
              ':now': now,
              ':payment': payment,
              ':awaiting': 'awaiting_payment',
            },
          },
        },
      ]);
    } catch (err) {
      if (failedTransactionIndexes(err).includes(0)) {
        throw new ProblemException(
          'order-not-payable', 409, 'Order is not awaiting payment',
          'this order was paid or cancelled by another request; reload it',
        );
      }
      throw err;
    }

    return { ...current, status: 'confirmed', currentStageId: firstStageId, stageEnteredAt: now, payment };
  }
```

`OrdersService` constructor gains `@Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider`; `orders.module.ts` imports `PaymentsModule`.

NOTE — the fake provider is deterministic and offline, so charge-then-conditional-write is safe here: a lost race after a successful fake charge costs nothing real. The comment in `pay` must say this, because a real provider slotted in later needs an idempotency key on the charge and a reconciliation story; that is explicitly out of scope (spec: Out of scope).

- [ ] **Step 4: `cancel` learns the unpaid states**

Current guard requires `status === 'confirmed'` and a cancellable stage. Extend: an `awaiting_payment` order is always cancellable — by its owner or by a tenant admin (the seller clearing stale unpaid orders).

Ownership check becomes:

```ts
    const principal = currentPrincipal();
    const isOwner = found.userId === principal.userId;
    const isAdmin = principal.role === 'admin';
    if (!found || (!isOwner && !(isAdmin && current.status === 'awaiting_payment'))) {
      throw new ProblemException('not-found', 404, 'Order not found');
    }
```

Cancellability guard becomes:

```ts
    const awaiting = current.status === 'awaiting_payment';
    const stage = current.stages.find((s) => s.id === current.currentStageId);
    if (!awaiting && (current.status !== 'confirmed' || !stage?.cancellable)) {
      // ... existing problem unchanged
    }
```

And the order-row condition in the transaction must match the state actually seen — replace the hard-coded `:confirmed` with the current status, and drop the stage condition when awaiting (an awaiting order has no stage):

```ts
          ConditionExpression: awaiting
            ? '#status = :expected'
            : '#status = :expected AND #currentStageId = :stage',
          ExpressionAttributeValues: {
            ':cancelled': 'cancelled',
            ':expected': current.status,
            ...(awaiting ? {} : { ':stage': current.currentStageId }),
          },
```

(`ExpressionAttributeNames` drops `#currentStageId` in the awaiting branch too.)

The stock-restore items are unchanged — an awaiting order reserved stock in `create` exactly like a confirmed one.

`advance` needs no change: it already refuses any status other than `'confirmed'` with `order-not-advanceable`, which is precisely the unpaid gate.

- [ ] **Step 5: Checkout service + controller**

Add to `packages/contracts/src/cart.ts` (and re-run contracts tests/build):

```ts
/** POST /checkout body: everything CreateOrder needs except items, which come from the cart. */
export const CheckoutRequestSchema = CreateOrderSchema.omit({ items: true });
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;
```

(Import `CreateOrderSchema` from `./order`. If `CreateOrderSchema` wraps its object in refinements that break `.omit`, rebuild the object from its parts instead — copy the field list from `order.ts` verbatim.)

`checkout.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { CheckoutRequest, OrderResponse } from '@marketplace/contracts';
import { CartService } from '../cart/cart.service';
import { OrdersService } from '../orders/orders.service';
import { ProblemException } from '../common/problem';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly cart: CartService,
    private readonly orders: OrdersService,
  ) {}

  async checkout(input: CheckoutRequest): Promise<OrderResponse> {
    const resolved = await this.cart.get();
    if (resolved.lines.length === 0) {
      throw new ProblemException('invalid-request', 422, 'Cart is empty',
        'add something to the cart before checking out');
    }
    const unavailable = resolved.lines.find((l) => l.unavailable);
    if (unavailable) {
      throw new ProblemException('invalid-request', 422, 'Product no longer available',
        `${unavailable.name} is no longer available; remove it from the cart`,
        { productId: unavailable.productId });
    }

    // The order transaction re-validates stock and price with conditions; this
    // service only shapes the input. The cart survives a failed checkout so the
    // buyer can adjust it; it is cleared only after the order exists.
    const order = await this.orders.create(
      {
        ...input,
        items: resolved.lines.map((l) => ({ productId: l.productId, quantity: l.qty })),
      },
      { awaitPayment: true },
    );
    await this.cart.clear();
    return order;
  }
}
```

`checkout.controller.ts` — mirror how `orders.controller.ts` handles the idempotency key on `POST /orders` (read it first; apply the same decorator/interceptor to this route):

```ts
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post()
  create(@ZodBody(CheckoutRequestSchema) body: CheckoutRequest): Promise<OrderResponse> {
    return this.checkout.checkout(body);
  }
}
```

`orders.controller.ts` gains:

```ts
  @Post(':id/pay')
  pay(
    @Param('id') id: string,
    @ZodBody(PayRequestSchema) body: PayRequest,
  ): Promise<OrderResponse> {
    return this.orders.pay(id, body.card);
  }
```

- [ ] **Step 6: Unit tests**

`checkout.service.test.ts`: empty cart → problem; unavailable line → problem naming the product; happy path calls `orders.create` with `awaitPayment: true` and the cart's lines, then clears the cart; a failing `orders.create` leaves the cart untouched (assert `clear` not called).

Extend the orders service tests (or add `orders.service.pay.test.ts` following the same stubbing pattern): pay on a non-awaiting order → `order-not-payable`; pay by a different user → 404; successful pay writes payment and enters stage 1; declined charge propagates and the order is not written; conditional failure on the write → `order-not-payable` (assert on the outcome/problem type, not the error class — race-test house rule).

- [ ] **Step 7: Run** — `pnpm --filter @marketplace/contracts test && pnpm --filter @marketplace/contracts build`, then `pnpm --filter @marketplace/engine test -- checkout` and `-- orders`, then `pnpm --filter @marketplace/engine build` → all green/clean.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src apps/engine/src
git commit -m "feat(engine): checkout into awaiting_payment gate; pay endpoint through payment provider"
```

---

### Task 6: Engine checkout e2e

**Files:**
- Create: `apps/engine/test/e2e/checkout.e2e.test.ts`

**Interfaces:**
- Consumes: routes from Tasks 3 and 5; the e2e helpers used by `storefront.e2e.test.ts`/`orders.e2e.test.ts` (auth, product creation).

- [ ] **Step 1: Write the suite** — against the running stack, one buyer + one admin per run:

1. Full loop: admin creates product (stock 5) → buyer carts qty 2 → `POST /checkout` with an idempotency key → order `awaiting_payment`, `currentStageId` null, stock now 3, cart now empty.
2. Advance refused while unpaid: admin `POST /orders/:id/advance` → 409 `order-not-advanceable`.
3. Declined card: `POST /orders/:id/pay` with `4000000000000002` → 402 `payment-declined`; order still `awaiting_payment`.
4. Retry succeeds: pay with `4242424242424242` → order `confirmed`, `currentStageId` = first stage id, `payment.last4 === '4242'`, `payment.amountMinor` equals the order total.
5. Double-pay: pay again → 409 `order-not-payable`.
6. Abandon restores stock: second checkout (new idempotency key, cart qty 1) → buyer `POST /orders/:id/cancel` → order `cancelled`, product stock back up by 1.
7. Empty-cart checkout → 422.
8. Same idempotency key replayed → the same order id comes back, no second order.

- [ ] **Step 2: Run it** — rebuild the engine container, then `pnpm --filter @marketplace/engine test:e2e -- checkout` → PASS. Run `-- orders` too: the existing orders suite must still pass untouched.

- [ ] **Step 3: Commit**

```bash
git add apps/engine/test/e2e/checkout.e2e.test.ts
git commit -m "test(engine): checkout, payment gate and abandonment e2e"
```

---

### Task 7: Web cart API client and server-backed CartProvider

**Files:**
- Create: `apps/web/lib/api/cart.ts`
- Create: `apps/web/lib/api/cart.test.ts`
- Modify: `apps/web/lib/cart/cart-context.tsx`
- Modify: `apps/web/lib/cart/cart-context.test.tsx`
- Modify: `apps/web/app/(shop)/products/[id]/page.tsx` (new `add` signature)
- Modify: `apps/web/app/(shop)/cart/page.tsx` (resolved lines, unavailable rendering)

**Interfaces:**
- Consumes: `request` from `./http` (same shape as `storefront.ts`), contracts schemas.
- Produces: `getCart(): Promise<CartResponse>`, `putCartLine(productId: string, qty: number): Promise<CartResponse>`, `clearCart(): Promise<CartResponse>`; `CartValue` becomes `{ cart: CartResponse; add(productId: string, qty: number): Promise<void>; setQty(productId: string, qty: number): Promise<void>; remove(productId: string): Promise<void>; clear(): Promise<void>; idempotencyKey: string; resetKey(): void; }`.

- [ ] **Step 1: API client + tests**

`apps/web/lib/api/cart.ts`, exactly the `storefront.ts` shape:

```ts
import { CartResponseSchema, type CartResponse } from '@marketplace/contracts';
import { request } from './http';

export const getCart = (): Promise<CartResponse> =>
  request('/cart', { schema: CartResponseSchema });

export const putCartLine = (productId: string, qty: number): Promise<CartResponse> =>
  request(`/cart/lines/${productId}`, { method: 'PUT', body: { qty }, schema: CartResponseSchema });

export const clearCart = (): Promise<CartResponse> =>
  request('/cart', { method: 'DELETE', schema: CartResponseSchema });
```

Tests mirror `apps/web/lib/api/storefront.test.ts` (mock `request`, assert path/method/schema).

- [ ] **Step 2: Rework `CartProvider`**

Keep the provider component and hook names. State becomes `cart: CartResponse` (`{ lines: [], totalMinor: 0 }` initial). On mount: `getCart()` (only when a token exists — follow how other authenticated fetches gate on the auth context). Mutations call the API and replace state with the returned resolved cart; apply an optimistic local update first and reconcile with the server response; on error, refetch `getCart()` and surface via `notifyProblem`. `sessionStorage` keeps ONLY the idempotency-key logic — the lines keys (`marketplace.cart`) are deleted entirely. `resetKey` semantics unchanged.

Consumers: product page's add button becomes `add(product.id, qty)`; the cart page reads `cart.lines` (resolved: `name`, `unitPriceMinor`, `image`, `stock`, `unavailable`) and `cart.totalMinor` instead of computing a client total. Unavailable lines render struck-through with a remove button and are excluded from the displayed total (the server already excludes them).

- [ ] **Step 3: Update tests** — rewrite `cart-context.test.tsx` against the mocked API module: mount fetches cart; `add` PUTs and updates state; `setQty(id, 0)`-via-`remove` sends `qty: 0`; failed mutation refetches. Update any product/cart page tests that used the old `add({...})` signature.

- [ ] **Step 4: Run** — `pnpm --filter @marketplace/web test -- cart` → PASS; `pnpm --filter @marketplace/web test` (no regressions); `pnpm --filter @marketplace/web build` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib apps/web/app
git commit -m "feat(web): cart lives on the server; provider keeps its interface"
```

---

### Task 8: Web checkout and payment pages

**Files:**
- Modify: `apps/web/app/(shop)/cart/page.tsx` (checkout action)
- Create: `apps/web/lib/api/checkout.ts` (+ extend `apps/web/lib/api/orders.ts` if one exists — read `apps/web/lib/api/` first and follow its file layout for the pay call)
- Create: `apps/web/app/(shop)/orders/[id]/pay/page.tsx`
- Create: `apps/web/app/(shop)/orders/[id]/pay/page.test.tsx`
- Modify: the order tracker page `apps/web/app/(shop)/orders/[id]/page.tsx` (awaiting_payment state)
- Modify: `apps/web/app/(admin)/admin/orders/page.tsx` and `apps/web/app/(admin)/admin/orders/[id]/page.tsx` (status chip, advance disabled)

**Interfaces:**
- Consumes: Task 7 provider; `POST /checkout`, `POST /orders/:id/pay` routes.
- Produces: `checkout(body: CheckoutRequest, idempotencyKey: string): Promise<OrderResponse>`; `payOrder(id: string, card: Card): Promise<OrderResponse>`.

- [ ] **Step 1: API calls** — `checkout.ts` follows how the cart page currently posts `POST /orders` with its idempotency key header (read the current cart page checkout handler first and reuse its header mechanism verbatim):

```ts
export const checkout = (body: CheckoutRequest, idempotencyKey: string): Promise<OrderResponse> =>
  request('/checkout', {
    method: 'POST', body, schema: OrderResponseSchema,
    headers: { 'idempotency-key': idempotencyKey },
  });

export const payOrder = (id: string, card: Card): Promise<OrderResponse> =>
  request(`/orders/${id}/pay`, { method: 'POST', body: { card }, schema: OrderResponseSchema });
```

(Match the real header name and `request` options shape to what the existing checkout uses — do not invent a new one.)

- [ ] **Step 2: Cart page** — button copy becomes "Checkout". On click: `checkout(...)` with the shipping/currency fields the page already collects → success: `resetKey()`, router.push(`/orders/${order.id}/pay`). Failure paths (insufficient stock, price changed) render exactly as today — the cart is untouched server-side.

- [ ] **Step 3: Pay page** — `orders/[id]/pay/page.tsx`: antd form with card number, expiry month/year, cvc. Client-side validation via `CardSchema.safeParse` (shared Luhn — same rejection the server gives). Submit → `payOrder` → success: `message.success('Payment received')`, push to `/orders/${id}` (tracker shows stage 1). Problem (402) → render the problem title/detail inline (the `notifyProblem`/`Alert` pattern the onboarding page uses), form intact for retry. If the order loads as anything but `awaiting_payment`, redirect to the tracker (covers refresh-after-success and deep links to paid orders). A visible line of helper text lists the three magic numbers — this is a simulation and the UI should say so.

- [ ] **Step 4: Tracker + cockpit** — tracker: when `status === 'awaiting_payment'` (and `currentStageId` null), render an "Awaiting payment" state ahead of the stage list with a "Pay now" link to the pay page; buyer's cancel button available (gate always cancellable). Cockpit orders list: `awaiting_payment` chip (follow the existing status→color mapping); order detail: advance button hidden/disabled while unpaid, cancel available to the admin.

- [ ] **Step 5: Tests** — pay page tests (jsdom, the `onboarding/page.test.tsx` pattern): renders form; Luhn-invalid number blocks submit with inline error; successful pay calls `payOrder` and navigates; 402 problem renders inline and keeps the form. Tracker test: `awaiting_payment` order shows the awaiting state, not a stage. Run `pnpm --filter @marketplace/web test` and `pnpm --filter @marketplace/web build` → green/clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): checkout to payment page; awaiting-payment states in tracker and cockpit"
```

---

### Task 9: Browser journeys, campaign, screenshots

**Files:**
- Modify: `apps/web/test/e2e-journeys/run.mjs` (new section 9)
- Modify: `apps/web/test/ui-campaign/run.mjs` (card form cases)

**Interfaces:**
- Consumes: everything shipped; journeys' existing `mint`/`signIn`/`api`/`createProduct` helpers.

- [ ] **Step 1: Journeys** — new section after owner onboarding, fresh tenant (the run's existing pattern):

1. *A buyer's cart follows them.* Buyer carts two products via the UI, reloads the page, cart still shows both lines (server-side now); `api` check: `GET /cart` shows 2 lines.
2. *Checkout, decline, pay.* Checkout from the cart page → lands on pay page → pay with `4000 0000 0000 0002` → decline renders, order still `awaiting_payment` via `api` → pay with `4242 4242 4242 4242` → tracker shows stage 1; `api`: order `confirmed`, `payment.last4 === '4242'`; stock decremented; cart empty.
3. *Abandoning an unpaid order restores stock.* Cart one product, checkout, then cancel from the tracker → `api`: order `cancelled`, stock restored.
4. *The seller cannot advance an unpaid order.* Checkout without paying; seller opens the order in the cockpit; no advance control; `api` advance attempt → 409.

- [ ] **Step 2: Campaign** — add ordered cases for: cart page with a struck-through unavailable line, pay page pristine, pay page after decline (error visible, form intact), tracker awaiting-payment state. Follow the campaign file's existing case format exactly.

- [ ] **Step 3: Run** — stack fully rebuilt (`docker compose -f docker/docker-compose.yml up -d --build --force-recreate engine web`), then `pnpm --filter @marketplace/web e2e:journeys` → all pass, and `pnpm --filter @marketplace/web ui:campaign` → all pass.

- [ ] **Step 4: Look at it** — screenshot cart, pay form, decline state, tracker awaiting state (browser or the preset-shots script pattern). Fix what looks wrong before calling it done — passing tests prove behaviour, not appearance.

- [ ] **Step 5: Commit**

```bash
git add apps/web/test
git commit -m "test(web): cart persistence, checkout and payment journeys; campaign cases"
```

---

### Task 10: Full verification and status

**Files:**
- Modify: `docs/STATUS.md` (new dated section)
- Create: `docs/STATUS-cart-checkout.md`

- [ ] **Step 1: Full sweep** — `npx turbo run test --concurrency=1` → all green (re-run any red suite alone before believing it).
- [ ] **Step 2: Whole system** — `pnpm e2e` → green.
- [ ] **Step 3: Builds** — `pnpm --filter @marketplace/engine build && pnpm --filter @marketplace/web build && pnpm --filter @marketplace/contracts build` → clean.
- [ ] **Step 4: Status docs** — `STATUS-cart-checkout.md`: what shipped, verification evidence (suite counts), decisions (gate over pay-first, fake provider semantics, no auto-expiry), defects found along the way. One-paragraph pointer section at the top of `STATUS.md`.
- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: status for server-side cart and checkout"
```

---

## Self-Review Notes

- Spec coverage: cart contracts/engine/web (Tasks 1–3, 7), checkout + gate (Task 5), fake provider + magic numbers (Task 4), pay flow + decline/retry (Tasks 5, 8), seller view (Task 8 Step 4), edge cases (Tasks 5, 6), testing matrix (Tasks 1–2, 4–6, 8–9), card handling (Task 4 result shape, Task 1 `PaymentSchema` without a number field). Out-of-scope items have no tasks — correct.
- Type consistency: `CartResponse{lines,totalMinor}`, `ResolvedCartLine.unavailable`, `pay(id, card)`, `charge(input) → {paymentId,last4}`, `create(input, {awaitPayment})` used identically across tasks.
- Known judgment calls an executor must respect: `toResponse` uses `!== undefined` so a stored null stage survives; cancel's condition expression must match the observed status; nothing precedes the line-item updates in any transaction.
