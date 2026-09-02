# Public Storefront Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visitor with no account opens `<tenant>.localhost:3002`, browses that shop's products and events, and is sent to sign in only when they try to buy.

**Architecture:** The engine gains one `@Public()` read surface under `/shops/:tenantId`, where a `ShopScope` provider validates the id against the shared `TENANT_ID_PATTERN` and runs the existing services inside a public tenant context. The web app resolves the tenant from the hostname, provides it through a `ShopProvider`, and every storefront page reads through one `useShopReads()` object that is bound to the public wrappers on a shop host and to today's token wrappers on the bare platform host. Nothing changes for the bare host.

**Tech Stack:** NestJS 10, DynamoDB single table, Zod contracts, Next.js 15 client components, antd 5, Jest (engine), Vitest (web), Playwright journeys.

**Spec:** `docs/superpowers/specs/2026-09-03-public-storefront-design.md`

## Global Constraints

- Every error is an RFC 9457 problem document from the closed `ProblemType` union in `apps/engine/src/common/problem.ts`; this plan adds no new type.
- Ownership and existence failures answer 404, never 403.
- Public product visibility is exactly `['active', 'out_of_stock']`.
- Tenant ids are validated with `TENANT_ID_PATTERN` from `@marketplace/auth`, never a second regex.
- No `window.confirm`, `alert` or `prompt` in web code.
- Host-side harnesses talk to `127.0.0.1`; browsers use `localhost` hostnames.
- Repo-wide test runs are `npx turbo run test --concurrency=1`; a red suite is re-run alone before it is believed.
- Commit messages carry no Claude attribution.

---

## File map

| File | Responsibility |
|---|---|
| `apps/engine/src/common/cors.ts` (new) | `originAllowed(origin, patterns)` pure matcher, wildcard-label aware |
| `apps/engine/src/app.factory.ts` | passes `originAllowed` as the CORS `origin` function |
| `apps/engine/src/products/dynamo-search.provider.ts` | `buildProductFilter(criteria, statuses?)` emits the `IN` clause |
| `apps/engine/src/products/search-provider.ts` | `search(criteria, opts?)` interface |
| `apps/engine/src/products/products.service.ts` | `VISIBLE_TO_SHOPPERS`, `listVisible`, `searchVisible`, `getVisible` |
| `apps/engine/src/shops/shop-scope.ts` (new) | tenant id validation + public principal + `runWithTenant` |
| `apps/engine/src/shops/shops.controller.ts` (new) | `/shops/:tenantId/*` public routes |
| `apps/engine/src/shops/shops.module.ts` (new) | wires the above; imported by `app.module.ts` |
| `apps/engine/src/settings/settings.module.ts` | exports `SettingsService` |
| `apps/engine/test/e2e/shops.e2e.test.ts` (new) | public surface against the running stack |
| `docker/docker-compose.yml` | `http://*.localhost:3002` in both `CORS_ORIGINS` |
| `apps/web/lib/env.ts` | `PLATFORM_HOST` |
| `apps/web/Dockerfile` | `NEXT_PUBLIC_PLATFORM_HOST` |
| `apps/web/lib/shop/shop-host.ts` (new) | `shopFromHost(host, platformHost)` |
| `apps/web/lib/shop/shop-context.tsx` (new) | `ShopProvider`, `useShop()` |
| `apps/web/lib/api/shop.ts` (new) | public read wrappers |
| `apps/web/lib/shop/reads.ts` (new) | `useShopReads()` |
| `apps/web/lib/schemas/schema-cache.tsx` | public schemas when the shop is public |
| `apps/web/app/layout.tsx` | mounts `ShopProvider` above `SchemaProvider` |
| `apps/web/app/(shop)/layout.tsx` | public gate, host mismatch sign-out, protected prefixes |
| `apps/web/components/shop-header.tsx` | anonymous state |
| `apps/web/components/storefront-hero.tsx` | unchanged; caller passes the shop tenant |
| `apps/web/components/announcement-bar.tsx`, `more-from-shop.tsx` | read through `useShopReads()` |
| `apps/web/app/(shop)/products/page.tsx`, `products/[id]/page.tsx`, `events/page.tsx`, `events/[id]/page.tsx` | read through `useShopReads()`; anonymous buy paths go to login |
| `apps/web/app/login/page.tsx` | honours `next` |
| `apps/web/test/e2e-journeys/run.mjs` | section "A stranger at the door" |
| `docs/STATUS-public-storefront.md`, `docs/STATUS.md` | status |

---

### Task 1: CORS wildcard origins

**Files:**
- Create: `apps/engine/src/common/cors.ts`
- Create: `apps/engine/src/common/cors.test.ts`
- Modify: `apps/engine/src/app.factory.ts:46-70`
- Modify: `apps/engine/src/common/cors.int-test.ts`
- Modify: `docker/docker-compose.yml` (both `CORS_ORIGINS`)

**Interfaces:**
- Produces: `originAllowed(origin: string | undefined, patterns: readonly string[]): boolean`; `parseCorsOrigins(raw: string): string[]`.

- [ ] **Step 1: Write the failing test** — `apps/engine/src/common/cors.test.ts`

```ts
import { originAllowed, parseCorsOrigins } from './cors';

describe('originAllowed', () => {
  const patterns = ['http://localhost:3002', 'http://127.0.0.1:3002', 'http://*.localhost:3002'];

  it('allows an exact entry', () => {
    expect(originAllowed('http://localhost:3002', patterns)).toBe(true);
    expect(originAllowed('http://127.0.0.1:3002', patterns)).toBe(true);
  });

  it('allows one label under a wildcard entry', () => {
    expect(originAllowed('http://acme.localhost:3002', patterns)).toBe(true);
    expect(originAllowed('http://jt-abc-a.localhost:3002', patterns)).toBe(true);
  });

  it('refuses two labels, another scheme, another port and another host', () => {
    expect(originAllowed('http://a.b.localhost:3002', patterns)).toBe(false);
    expect(originAllowed('https://acme.localhost:3002', patterns)).toBe(false);
    expect(originAllowed('http://acme.localhost:3000', patterns)).toBe(false);
    expect(originAllowed('http://acme.localhost.evil:3002', patterns)).toBe(false);
    expect(originAllowed('http://evil.example:3002', patterns)).toBe(false);
  });

  it('refuses an empty label and a missing origin', () => {
    expect(originAllowed('http://.localhost:3002', patterns)).toBe(false);
    expect(originAllowed(undefined, patterns)).toBe(false);
  });

  it('parses a comma list and drops blanks', () => {
    expect(parseCorsOrigins(' http://a , ,http://*.b ')).toEqual(['http://a', 'http://*.b']);
  });
});
```

- [ ] **Step 2: Run it** — `pnpm --filter @marketplace/engine exec jest src/common/cors.test.ts` → FAIL, cannot find module `./cors`.

- [ ] **Step 3: Implement** — `apps/engine/src/common/cors.ts`

```ts
/**
 * Which browser origins the engine answers.
 *
 * Exact entries match exactly, as they always have. An entry whose host
 * starts with `*.` matches one label in front of the rest -- the shop-per-
 * subdomain scheme the storefront uses (`acme.localhost:3002`) -- and only
 * one: `a.b.localhost` is not a shop and is refused. Scheme and port must
 * match exactly; a wildcard never widens either.
 */
const LABEL = /^[A-Za-z0-9_-]{1,64}$/;

export function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

export function originAllowed(origin: string | undefined, patterns: readonly string[]): boolean {
  if (!origin) return false;
  for (const pattern of patterns) {
    if (pattern === origin) return true;
    const star = pattern.indexOf('://*.');
    if (star === -1) continue;
    const scheme = pattern.slice(0, star + 3);
    const rest = pattern.slice(star + '://*.'.length);
    if (!origin.startsWith(scheme)) continue;
    const host = origin.slice(scheme.length);
    if (!host.endsWith(`.${rest}`)) continue;
    const label = host.slice(0, host.length - rest.length - 1);
    if (LABEL.test(label)) return true;
  }
  return false;
}
```

Then in `app.factory.ts` replace the `origin:` array with a function:

```ts
  if (env.CORS_ORIGINS) {
    const patterns = parseCorsOrigins(env.CORS_ORIGINS);
    app.enableCors({
      // A function, not a list: `http://*.localhost:3002` admits one shop
      // label per origin, which a static list cannot express. See cors.ts.
      origin: (origin, callback) => callback(null, originAllowed(origin, patterns)),
```

(import `originAllowed, parseCorsOrigins` from `./common/cors`). Add to `cors.int-test.ts` `beforeAll`: `process.env.CORS_ORIGINS = 'http://localhost:3002,http://*.localhost:3002';` and two cases:

```ts
  it('allows a shop subdomain under the wildcard entry', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://acme.localhost:3002', 'Access-Control-Request-Method': 'GET' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://acme.localhost:3002');
  });

  it('refuses a two-label host the wildcard does not cover', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://a.b.localhost:3002', 'Access-Control-Request-Method': 'GET' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
```

In `docker/docker-compose.yml`, both `CORS_ORIGINS` become
`http://localhost:3002,http://127.0.0.1:3002,http://*.localhost:3002` with a
one-line comment: `# *.localhost: one shop per subdomain (see engine common/cors.ts).`

- [ ] **Step 4: Run** — `pnpm --filter @marketplace/engine exec jest src/common/cors` → PASS (the int-test needs Redis from the stack; if the stack is down run the unit file alone and the int-test in Task 4's stack run).

- [ ] **Step 5: Commit** — `git commit -m "feat(engine): wildcard shop-subdomain origins in CORS"`

---

### Task 2: Shopper-visible product reads

**Files:**
- Modify: `apps/engine/src/products/search-provider.ts`
- Modify: `apps/engine/src/products/dynamo-search.provider.ts`
- Modify: `apps/engine/src/products/dynamo-search.provider.test.ts`
- Modify: `apps/engine/src/products/products.service.ts`
- Create: `apps/engine/src/products/products.service.visible.test.ts`

**Interfaces:**
- Produces: `VISIBLE_TO_SHOPPERS: readonly ProductStatus[]`; `ProductsService.listVisible(limit: number, cursor: string | null): Promise<Page<ProductResponse>>`; `searchVisible(criteria: SearchProducts): Promise<Page<ProductResponse>>`; `getVisible(id: string): Promise<ProductResponse>`; `buildProductFilter(criteria: SearchProducts, statuses?: readonly ProductStatus[]): FilterSpec | undefined`; `SearchProvider.search(criteria, opts?: { statuses?: readonly ProductStatus[] })`.

- [ ] **Step 1: Failing tests** — append to `dynamo-search.provider.test.ts`:

```ts
  it('forces the visible statuses and ignores a status in the criteria', () => {
    const filter = buildProductFilter(SearchProductsSchema.parse({ status: 'draft' }), [
      'active',
      'out_of_stock',
    ])!;
    expect(filter.expression).toBe('#f0 IN (:v0, :v1)');
    expect(filter.names).toEqual({ '#f0': 'status' });
    expect(filter.values).toEqual({ ':v0': 'active', ':v1': 'out_of_stock' });
  });

  it('ANDs the visible statuses onto other clauses', () => {
    const filter = buildProductFilter(SearchProductsSchema.parse({ category: 'mugs' }), ['active'])!;
    expect(filter.expression).toBe('#f0 = :v0 AND #f1 IN (:v1)');
  });
```

And `products.service.visible.test.ts`:

```ts
import { runWithTenant } from '../common/tenant-context';
import { ProductsService, VISIBLE_TO_SHOPPERS } from './products.service';

const record = (status: string) => ({
  PK: 'TENANT#t', SK: 'PRODUCT#p1', entityType: 'Product', id: 'p1', status,
  name: 'Mug', description: '', priceMinor: 100, currency: 'USD', category: 'mugs',
  stock: 1, images: [], attributes: {}, createdAt: 'x', updatedAt: 'x', search: 'mug',
});

const principal = { tenantId: 't', userId: 'anonymous', role: 'public' };

function service(found: Record<string, unknown> | null) {
  const repo = { get: jest.fn().mockResolvedValue(found), queryPrefix: jest.fn() };
  const provider = { search: jest.fn() };
  return { svc: new ProductsService(repo as never, {} as never, provider as never), repo, provider };
}

describe('shopper visibility', () => {
  it('names exactly the two statuses a shopper may see', () => {
    expect([...VISIBLE_TO_SHOPPERS]).toEqual(['active', 'out_of_stock']);
  });

  it('returns a visible product without table keys', async () => {
    const { svc } = service(record('out_of_stock'));
    const got = await runWithTenant(principal, () => svc.getVisible('p1'));
    expect(got.id).toBe('p1');
    expect('PK' in got).toBe(false);
  });

  it.each(['draft', 'archived'])('answers not-found for a %s product', async (status) => {
    const { svc } = service(record(status));
    await expect(runWithTenant(principal, () => svc.getVisible('p1'))).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('lists with the status filter in the query', async () => {
    const { svc, repo } = service(null);
    repo.queryPrefix.mockResolvedValue({ items: [], nextCursor: null });
    await runWithTenant(principal, () => svc.listVisible(10, null));
    expect(repo.queryPrefix.mock.calls[0][1].filter.expression).toBe('#f0 IN (:v0, :v1)');
  });

  it('searches with the visible statuses forced', async () => {
    const { svc, provider } = service(null);
    provider.search.mockResolvedValue({ items: [], nextCursor: null });
    await runWithTenant(principal, () =>
      svc.searchVisible({ attributes: {}, limit: 25, cursor: null, status: 'draft' }),
    );
    expect(provider.search.mock.calls[0][1]).toEqual({ statuses: VISIBLE_TO_SHOPPERS });
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @marketplace/engine exec jest src/products` → FAIL (missing exports).

- [ ] **Step 3: Implement**

`search-provider.ts`:

```ts
import { Page, ProductRecord, ProductStatus, SearchProducts } from '@marketplace/contracts';

export const SEARCH_PROVIDER = Symbol('SEARCH_PROVIDER');

export interface SearchOptions {
  /** When set, only these statuses match and any `status` in the criteria is ignored. */
  statuses?: readonly ProductStatus[];
}

export interface SearchProvider {
  search(criteria: SearchProducts, opts?: SearchOptions): Promise<Page<ProductRecord>>;
}
```

`dynamo-search.provider.ts` — signature `buildProductFilter(criteria: SearchProducts, statuses?: readonly ProductStatus[])`; in the `core` block replace the status line with `if (statuses === undefined && criteria.status !== undefined) core.push(['status', criteria.status, '=']);` and after the attribute loop add:

```ts
  // A public reader's status set is not the caller's to widen: it is ANDed
  // on last and any `status` in the criteria was dropped above.
  if (statuses !== undefined) {
    names[`#f${n}`] = 'status';
    const keys = statuses.map((status, i) => {
      values[`:v${n + i}`] = status;
      return `:v${n + i}`;
    });
    clauses.push(`#f${n} IN (${keys.join(', ')})`);
    n += statuses.length;
  }
```

`DynamoSearchProvider.search(criteria, opts = {})` passes `buildProductFilter(criteria, opts.statuses)`.

`products.service.ts` additions:

```ts
/**
 * What a stranger may see. Draft is a half-written listing and archived is a
 * withdrawn one; neither exists as far as the public surface is concerned,
 * so a request for one answers the same 404 a made-up id would.
 */
export const VISIBLE_TO_SHOPPERS: readonly ProductStatus[] = ['active', 'out_of_stock'];

const visibleFilter = (): FilterSpec => buildProductFilter(EMPTY_CRITERIA, VISIBLE_TO_SHOPPERS)!;
const EMPTY_CRITERIA = SearchProductsSchema.parse({});
```

```ts
  async getVisible(id: string): Promise<ProductResponse> {
    const found = await this.repo.get<ProductRecord>(entitySk('Product', id));
    if (!found || !VISIBLE_TO_SHOPPERS.includes(found.status)) {
      throw new ProblemException('not-found', 404, 'Product not found');
    }
    return toResponse(found);
  }

  async listVisible(limit: number, cursor: string | null): Promise<Page<ProductResponse>> {
    const page = await this.repo.queryPrefix<ProductRecord>(skPrefix('Product'), {
      limit,
      cursor,
      filter: visibleFilter(),
    });
    return { items: page.items.map(toResponse), nextCursor: page.nextCursor };
  }

  async searchVisible(criteria: SearchProducts): Promise<Page<ProductResponse>> {
    const page = await this.searchProvider.search(criteria, { statuses: VISIBLE_TO_SHOPPERS });
    return { items: page.items.map(toResponse), nextCursor: page.nextCursor };
  }
```

Imports: `ProductStatus, SearchProductsSchema` from contracts, `FilterSpec` from the repository, `buildProductFilter` from `./dynamo-search.provider`.

- [ ] **Step 4: Run** — `pnpm --filter @marketplace/engine exec jest src/products` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(engine): shopper-visible product reads with the status filter in the query"`

---

### Task 3: The `shops` module

**Files:**
- Create: `apps/engine/src/shops/shop-scope.ts`, `shop-scope.test.ts`, `shops.controller.ts`, `shops.module.ts`
- Modify: `apps/engine/src/settings/settings.module.ts` (add `exports: [SettingsService]`)
- Modify: `apps/engine/src/app.module.ts` (import `ShopsModule`)

**Interfaces:**
- Produces: `ShopScope.run<T>(tenantId: string, fn: () => Promise<T>): Promise<T>`; routes `GET /shops/:t/storefront|announcement|schemas|products|products/:id|events|events/:id`, `POST /shops/:t/products/search`.

- [ ] **Step 1: Failing test** — `shop-scope.test.ts`

```ts
import { currentPrincipal } from '../common/tenant-context';
import { ShopScope } from './shop-scope';

describe('ShopScope', () => {
  const scope = new ShopScope();

  it('binds a public principal for the tenant while fn runs', async () => {
    const seen = await scope.run('acme', async () => currentPrincipal());
    expect(seen).toEqual({ tenantId: 'acme', userId: 'anonymous', role: 'public' });
  });

  it.each(['', 'a b', 'TENANT#x', 'a/b', 'x'.repeat(65)])(
    'answers not-found for the malformed id %j',
    async (bad) => {
      await expect(scope.run(bad, async () => 1)).rejects.toMatchObject({
        problem: { status: 404, type: 'https://marketplace.local/problems/not-found' },
      });
    },
  );

  it('leaves no tenant context behind', async () => {
    await scope.run('acme', async () => 1);
    expect(() => currentPrincipal()).toThrow(/no tenant context/);
  });
});
```

- [ ] **Step 2: Run** — FAIL, module missing.

- [ ] **Step 3: Implement**

`shop-scope.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { TENANT_ID_PATTERN } from '@marketplace/auth';
import { ProblemException } from '../common/problem';
import { runWithTenant, TenantPrincipal } from '../common/tenant-context';

/**
 * The public storefront's way into a tenant.
 *
 * Every other request derives its tenant from a verified JWT claim; this is
 * the second place a tenant id enters from outside (the SQS consumer is the
 * third) and it enforces the same pattern before the value can reach a
 * partition key. A stranger asking for a shop that fails the pattern is told
 * there is no such shop -- not that the id is malformed, which is one more
 * fact than they need.
 *
 * The principal has role `public`, which no `@Roles()` list and no service
 * admin check accepts, and a userId that owns nothing.
 */
@Injectable()
export class ShopScope {
  run<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    if (!TENANT_ID_PATTERN.test(tenantId)) {
      throw new ProblemException('not-found', 404, 'No such shop');
    }
    const principal: TenantPrincipal = { tenantId, userId: 'anonymous', role: 'public' };
    return runWithTenant(principal, fn);
  }
}
```

`shops.controller.ts`:

```ts
import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  DynamicEntityTypeSchema,
  Page,
  SearchProducts,
  SearchProductsSchema,
  SchemaList,
  StorefrontPublicResponse,
  Announcement,
} from '@marketplace/contracts';
import { Public } from '../auth/public.decorator';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { ListQuery, ListQuerySchema } from '../common/list-query.schema';
import { EventResponse, EventsService } from '../events/events.service';
import { ProductResponse, ProductsService } from '../products/products.service';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { SettingsService } from '../settings/settings.service';
import { StorefrontService } from '../storefront/storefront.service';
import { ShopScope } from './shop-scope';

/**
 * What a stranger may read about a shop. Every route is `@Public()` and every
 * handler is one `ShopScope.run` around a service call the cockpit already
 * uses -- the visibility rules live in the services, not here.
 */
@Controller('shops/:tenantId')
export class ShopsController {
  constructor(
    private readonly scope: ShopScope,
    private readonly products: ProductsService,
    private readonly events: EventsService,
    private readonly storefront: StorefrontService,
    private readonly settings: SettingsService,
    private readonly registry: SchemaRegistryService,
  ) {}

  @Get('storefront')
  @Public()
  getStorefront(@Param('tenantId') tenantId: string): Promise<StorefrontPublicResponse> {
    return this.scope.run(tenantId, async () => ({ config: await this.storefront.getPublished() }));
  }

  @Get('announcement')
  @Public()
  getAnnouncement(@Param('tenantId') tenantId: string): Promise<Announcement> {
    return this.scope.run(tenantId, () => this.settings.getAnnouncement());
  }

  @Get('schemas')
  @Public()
  listSchemas(@Param('tenantId') tenantId: string): Promise<SchemaList> {
    return this.scope.run(tenantId, async () => ({
      items: await Promise.all(
        DynamicEntityTypeSchema.options.map(async (entityType) => {
          const { version, fields } = await this.registry.get(entityType);
          return { entityType, version, fields };
        }),
      ),
    }));
  }

  @Get('products')
  @Public()
  listProducts(
    @Param('tenantId') tenantId: string,
    @ZodQuery(ListQuerySchema) query: ListQuery,
  ): Promise<Page<ProductResponse>> {
    return this.scope.run(tenantId, () => this.products.listVisible(query.limit, query.cursor ?? null));
  }

  @Post('products/search')
  @Public()
  @HttpCode(200)
  searchProducts(
    @Param('tenantId') tenantId: string,
    @ZodBody(SearchProductsSchema) body: SearchProducts,
  ): Promise<Page<ProductResponse>> {
    return this.scope.run(tenantId, () => this.products.searchVisible(body));
  }

  @Get('products/:id')
  @Public()
  getProduct(@Param('tenantId') tenantId: string, @Param('id') id: string): Promise<ProductResponse> {
    return this.scope.run(tenantId, () => this.products.getVisible(id));
  }

  @Get('events')
  @Public()
  listEvents(
    @Param('tenantId') tenantId: string,
    @ZodQuery(ListQuerySchema) query: ListQuery,
  ): Promise<Page<EventResponse>> {
    return this.scope.run(tenantId, () => this.events.list(query.limit, query.cursor ?? null));
  }

  @Get('events/:id')
  @Public()
  getEvent(@Param('tenantId') tenantId: string, @Param('id') id: string): Promise<EventResponse> {
    return this.scope.run(tenantId, () => this.events.get(id));
  }
}
```

(`SchemaList` type: `z.infer<typeof SchemaListSchema>` — confirm it is exported from contracts; if not, add `export type SchemaList = z.infer<typeof SchemaListSchema>;` beside the schema in `responses.ts`.)

`shops.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { ProductsModule } from '../products/products.module';
import { SettingsModule } from '../settings/settings.module';
import { StorefrontModule } from '../storefront/storefront.module';
import { ShopScope } from './shop-scope';
import { ShopsController } from './shops.controller';

@Module({
  imports: [ProductsModule, EventsModule, StorefrontModule, SettingsModule],
  controllers: [ShopsController],
  providers: [ShopScope],
})
export class ShopsModule {}
```

`SettingsModule` gains `exports: [SettingsService]`. `app.module.ts` imports `ShopsModule` after `StorefrontModule`.

- [ ] **Step 4: Run** — `pnpm --filter @marketplace/engine exec jest src/shops` → PASS; `pnpm --filter @marketplace/engine build` → clean.

- [ ] **Step 5: Commit** — `git commit -m "feat(engine): public read surface under /shops/:tenantId"`

---

### Task 4: Engine e2e for the public surface

**Files:**
- Create: `apps/engine/test/e2e/shops.e2e.test.ts`

- [ ] **Step 1: Write the suite**

```ts
import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

const TENANT = `shop-public-${Date.now()}`;
const OTHER = `shop-other-${Date.now()}`;
const shop = (p: string) => `${baseUrl}/api/v1/shops/${TENANT}${p}`;

const product = (name: string, status: string) => ({
  name, description: 'public surface fixture', priceMinor: 1200, currency: 'USD',
  category: 'mugs', stock: 3, images: [], status, attributes: {},
});

describe('public shop surface', () => {
  let admin: Record<string, string>;
  let other: Record<string, string>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await waitForHealthy();
    admin = await authHeaders(TENANT, `${TENANT}-admin@example.com`, 'admin');
    other = await authHeaders(OTHER, `${OTHER}-admin@example.com`, 'admin');
    for (const status of ['active', 'out_of_stock', 'draft', 'archived']) {
      const res = await fetch(`${baseUrl}/api/v1/products`, {
        method: 'POST', headers: admin, body: JSON.stringify(product(`${status} mug`, status)),
      });
      expect(res.status).toBe(201);
      ids[status] = ((await res.json()) as { id: string }).id;
    }
    const foreign = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST', headers: other, body: JSON.stringify(product('foreign mug', 'active')),
    });
    ids.foreign = ((await foreign.json()) as { id: string }).id;
  });

  it('lists only what a shopper may see, with no token', async () => {
    const res = await fetch(shop('/products?limit=50'));
    expect(res.status).toBe(200);
    const statuses = ((await res.json()) as { items: { status: string }[] }).items.map((i) => i.status).sort();
    expect(statuses).toEqual(['active', 'out_of_stock']);
  });

  it('the admin still sees the draft through the token route', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products?limit=50`, { headers: admin });
    const statuses = ((await res.json()) as { items: { status: string }[] }).items.map((i) => i.status).sort();
    expect(statuses).toEqual(['active', 'archived', 'draft', 'out_of_stock']);
  });

  it.each(['draft', 'archived'])('answers 404 for a %s product by id', async (status) => {
    const res = await fetch(shop(`/products/${ids[status]}`));
    expect(res.status).toBe(404);
  });

  it('serves a visible product by id without table keys', async () => {
    const res = await fetch(shop(`/products/${ids.active}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe('active mug');
    expect(body.PK).toBeUndefined();
  });

  it('ignores a status a searcher asks for', async () => {
    const res = await fetch(shop('/products/search'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'draft', attributes: {}, limit: 50 }),
    });
    expect(res.status).toBe(200);
    const names = ((await res.json()) as { items: { name: string }[] }).items.map((i) => i.name);
    expect(names).not.toContain('draft mug');
    expect(names).toContain('active mug');
  });

  it("does not reach another shop's product through this shop", async () => {
    const res = await fetch(shop(`/products/${ids.foreign}`));
    expect(res.status).toBe(404);
  });

  it('answers 404 for a malformed shop id', async () => {
    const res = await fetch(`${baseUrl}/api/v1/shops/${encodeURIComponent('a b')}/products`);
    expect(res.status).toBe(404);
  });

  it('serves the announcement, the schemas and the events list', async () => {
    expect((await fetch(shop('/announcement'))).status).toBe(200);
    const schemas = await fetch(shop('/schemas'));
    expect(schemas.status).toBe(200);
    expect(((await schemas.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);
    expect((await fetch(shop('/events?limit=5'))).status).toBe(200);
  });

  it('serves the storefront config only once published', async () => {
    const before = await fetch(shop('/storefront'));
    expect(await before.json()).toEqual({ config: null });
    const config = {
      presetId: 'market', overrides: {},
      about: { title: 'About', sections: [{ heading: 'Us', body: 'Mugs.' }] },
      banners: [],
      businessProfile: { kind: 'shop', name: 'Mugs', tone: 'warm', audience: 'all' },
    };
    await fetch(`${baseUrl}/api/v1/storefront/draft`, { method: 'PUT', headers: admin, body: JSON.stringify(config) });
    await fetch(`${baseUrl}/api/v1/storefront/publish`, { method: 'POST', headers: admin });
    const after = (await (await fetch(shop('/storefront'))).json()) as { config: { presetId: string } };
    expect(after.config.presetId).toBe('market');
    expect((await fetch(shop('/storefront/draft'))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Rebuild the engine container and run** — from the repo root:

```
docker compose -f docker/docker-compose.yml up -d --build --force-recreate engine
pnpm --filter @marketplace/engine test:e2e -- shops
```

Expected: PASS. Then the whole engine e2e: `pnpm --filter @marketplace/engine test:e2e` → all suites green.

- [ ] **Step 3: Commit** — `git commit -m "test(engine): public shop surface end to end"`

---

### Task 5: Host resolution and shop context (web)

**Files:**
- Modify: `apps/web/lib/env.ts` (add `PLATFORM_HOST`)
- Modify: `apps/web/Dockerfile` (add `ENV NEXT_PUBLIC_PLATFORM_HOST=localhost:3002`)
- Create: `apps/web/lib/shop/shop-host.ts`, `shop-host.test.ts`, `shop-context.tsx`
- Modify: `apps/web/app/layout.tsx` (mount `ShopProvider` above `SchemaProvider`)

**Interfaces:**
- Produces: `shopFromHost(host: string, platformHost: string): string | null`; `interface Shop { tenantId: string }`; `useShop(): Shop | null`; `ShopProvider`.

- [ ] **Step 1: Failing test** — `shop-host.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { shopFromHost } from './shop-host';

describe('shopFromHost', () => {
  const platform = 'localhost:3002';

  it('reads one label in front of the platform host', () => {
    expect(shopFromHost('acme.localhost:3002', platform)).toBe('acme');
    expect(shopFromHost('jt-k3x-a.localhost:3002', platform)).toBe('jt-k3x-a');
  });

  it('is null on the bare platform host', () => {
    expect(shopFromHost('localhost:3002', platform)).toBeNull();
    expect(shopFromHost('127.0.0.1:3002', platform)).toBeNull();
  });

  it('is null for two labels, a foreign host and a reserved label', () => {
    expect(shopFromHost('a.b.localhost:3002', platform)).toBeNull();
    expect(shopFromHost('acme.localhost:3000', platform)).toBeNull();
    expect(shopFromHost('acme.example.com', platform)).toBeNull();
    for (const reserved of ['admin', 'www', 'api']) {
      expect(shopFromHost(`${reserved}.localhost:3002`, platform)).toBeNull();
    }
  });

  it('compares hosts case-insensitively and keeps the tenant id as typed', () => {
    expect(shopFromHost('Acme.LOCALHOST:3002', platform)).toBe('Acme');
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @marketplace/web exec vitest run lib/shop` → FAIL.

- [ ] **Step 3: Implement**

`lib/env.ts` append:

```ts
/** The host shops hang off: `<tenant>.<PLATFORM_HOST>` is a shop. */
export const PLATFORM_HOST = process.env.NEXT_PUBLIC_PLATFORM_HOST ?? 'localhost:3002';
```

`lib/shop/shop-host.ts`:

```ts
// The same shape the engine's TENANT_ID_PATTERN accepts; a label that fails
// it could never name a shop, so it is not one.
const TENANT_LABEL = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED = new Set(['admin', 'www', 'api']);

/**
 * Which shop a hostname names, or null for the platform itself.
 *
 * Exactly one label in front of the platform host: `acme.localhost:3002` is
 * the acme shop, `localhost:3002` is the console as it always was, and
 * `a.b.localhost:3002` is nobody. Ports travel with the host string, so a
 * shop on another port is a different platform and answers null.
 */
export function shopFromHost(host: string, platformHost: string): string | null {
  const suffix = `.${platformHost.toLowerCase()}`;
  const lower = host.toLowerCase();
  if (!lower.endsWith(suffix)) return null;
  const label = host.slice(0, host.length - suffix.length);
  if (!TENANT_LABEL.test(label) || RESERVED.has(label.toLowerCase())) return null;
  return label;
}
```

`lib/shop/shop-context.tsx`:

```tsx
'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { PLATFORM_HOST } from '../env';
import { shopFromHost } from './shop-host';

export interface Shop {
  /** The tenant this hostname names. Reads on this host go through /shops/:tenantId. */
  tenantId: string;
}

type ShopState = { ready: false } | { ready: true; shop: Shop | null };

const ShopContext = createContext<ShopState>({ ready: false });

/**
 * Resolved from `window.location.host` after mount -- the host is a browser
 * fact, and reading it during render would differ between server and client.
 * Until then `ready` is false and the shop shell renders nothing, exactly as
 * it already waits for the session.
 */
export function ShopProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ShopState>({ ready: false });
  useEffect(() => {
    const tenantId = shopFromHost(window.location.host, PLATFORM_HOST);
    setState({ ready: true, shop: tenantId ? { tenantId } : null });
  }, []);
  return <ShopContext.Provider value={state}>{children}</ShopContext.Provider>;
}

/** `undefined` before the host is known; `null` on the bare platform host. */
export function useShop(): Shop | null | undefined {
  const state = useContext(ShopContext);
  return state.ready ? state.shop : undefined;
}
```

`app/layout.tsx`: import `ShopProvider` and wrap `<SchemaProvider>` in `<ShopProvider>` (inside `AuthProvider`). Dockerfile: `ENV NEXT_PUBLIC_PLATFORM_HOST=localhost:3002` beside the other two.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(web): the hostname names the shop"`

---

### Task 6: Public read wrappers and `useShopReads`

**Files:**
- Create: `apps/web/lib/api/shop.ts`, `apps/web/lib/shop/reads.ts`, `apps/web/lib/shop/reads.test.tsx`
- Modify: `apps/web/lib/schemas/schema-cache.tsx`

**Interfaces:**
- Produces: `interface ShopReads { listProducts(limit, cursor); searchProducts(body); getProduct(id); listEvents(limit, cursor); getEvent(id); getStorefront(); getAnnouncement(); listSchemas() }`; `useShopReads(): ShopReads`; `readsFor(shop: Shop | null): ShopReads`.

- [ ] **Step 1: Failing test** — `reads.test.tsx`

```tsx
import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/products', () => ({ listProducts: vi.fn(() => 'token-list') }));
vi.mock('../api/shop', () => ({
  publicListProducts: vi.fn((tenantId: string) => `public-list:${tenantId}`),
}));

import { readsFor } from './reads';

describe('readsFor', () => {
  it('binds the public wrappers to the host tenant', () => {
    expect(readsFor({ tenantId: 'acme' }).listProducts(5, null)).toBe('public-list:acme');
  });

  it('uses the token wrappers on the platform host', () => {
    expect(readsFor(null).listProducts(5, null)).toBe('token-list');
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`lib/api/shop.ts`:

```ts
import {
  AnnouncementSchema,
  EventResponseSchema,
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
  request(`${base(tenantId)}/products`, { query: { limit, cursor: cursor ?? undefined }, schema: Products });

export const publicSearchProducts = (tenantId: string, body: SearchProducts) =>
  request(`${base(tenantId)}/products/search`, { method: 'POST', body, schema: Products });

export const publicGetProduct = (tenantId: string, id: string) =>
  request(`${base(tenantId)}/products/${id}`, { schema: ProductResponseSchema });

export const publicListEvents = (tenantId: string, limit: number, cursor: string | null) =>
  request(`${base(tenantId)}/events`, { query: { limit, cursor: cursor ?? undefined }, schema: Events });

export const publicGetEvent = (tenantId: string, id: string) =>
  request(`${base(tenantId)}/events/${id}`, { schema: EventResponseSchema });

export const publicGetStorefront = (tenantId: string) =>
  request(`${base(tenantId)}/storefront`, { schema: StorefrontPublicResponseSchema }).then((r) => r.config);

export const publicGetAnnouncement = (tenantId: string) =>
  request(`${base(tenantId)}/announcement`, { schema: AnnouncementSchema });

export const publicListSchemas = (tenantId: string) =>
  request(`${base(tenantId)}/schemas`, { schema: SchemaListSchema });
```

`lib/shop/reads.ts`:

```ts
'use client';

import { useMemo } from 'react';
import type {
  Announcement, EventResponse, Page, ProductResponse, SchemaList, SearchProducts, StorefrontConfig,
} from '@marketplace/contracts';
import { getEvent, listEvents } from '../api/events';
import { getProduct, listProducts, searchProducts } from '../api/products';
import { getAnnouncement } from '../api/settings';
import { listSchemas } from '../api/schemas';
import { getPublishedStorefront } from '../api/storefront';
import * as pub from '../api/shop';
import { useShop, type Shop } from './shop-context';

export interface ShopReads {
  listProducts(limit: number, cursor: string | null): Promise<Page<ProductResponse>>;
  searchProducts(body: SearchProducts): Promise<Page<ProductResponse>>;
  getProduct(id: string): Promise<ProductResponse>;
  listEvents(limit: number, cursor: string | null): Promise<Page<EventResponse>>;
  getEvent(id: string): Promise<EventResponse>;
  getStorefront(): Promise<StorefrontConfig | null>;
  getAnnouncement(): Promise<Announcement>;
  listSchemas(): Promise<SchemaList>;
}

/**
 * One object, two bindings. On a shop host every read is public and names
 * the tenant in its path; on the platform host every read is the token route
 * it always was. Pages call the object and never learn which.
 */
export function readsFor(shop: Shop | null): ShopReads {
  if (!shop) {
    return {
      listProducts, searchProducts, getProduct, listEvents, getEvent,
      getStorefront: getPublishedStorefront, getAnnouncement, listSchemas,
    };
  }
  const t = shop.tenantId;
  return {
    listProducts: (limit, cursor) => pub.publicListProducts(t, limit, cursor),
    searchProducts: (body) => pub.publicSearchProducts(t, body),
    getProduct: (id) => pub.publicGetProduct(t, id),
    listEvents: (limit, cursor) => pub.publicListEvents(t, limit, cursor),
    getEvent: (id) => pub.publicGetEvent(t, id),
    getStorefront: () => pub.publicGetStorefront(t),
    getAnnouncement: () => pub.publicGetAnnouncement(t),
    listSchemas: () => pub.publicListSchemas(t),
  };
}

export function useShopReads(): ShopReads {
  const shop = useShop();
  return useMemo(() => readsFor(shop ?? null), [shop]);
}
```

(`SchemaList` and `Page` types from contracts — add `export type SchemaList = z.infer<typeof SchemaListSchema>;` in `responses.ts` if absent; `Page` already exists.)

`schema-cache.tsx`: replace the `token` effect with

```tsx
  const shop = useShop();
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { items } = shop ? await publicListSchemas(shop.tenantId) : await listSchemas();
      setSchemas(Object.fromEntries(items.map((item) => [item.entityType, item])) as SchemaMap);
    } catch {
      // Left as-is: a stale cache is more useful than an empty one.
    } finally {
      setLoading(false);
    }
  }, [shop]);

  useEffect(() => {
    // A shop host needs no session to know its own fields; the platform host
    // still waits for one, because the token is what names the tenant there.
    if (shop || token) void refresh();
    else if (shop === null) setSchemas(null);
  }, [shop, token, refresh]);
```

- [ ] **Step 4: Run** — `pnpm --filter @marketplace/web exec vitest run lib` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(web): one read object bound to the public or the token routes"`

---

### Task 7: The shop shell opens to strangers

**Files:**
- Modify: `apps/web/app/(shop)/layout.tsx`
- Create: `apps/web/app/(shop)/layout.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const push = vi.fn();
const signOut = vi.fn();
let pathname = '/products';
let principal: { tenantId: string; role: string } | null = null;
let shop: { tenantId: string } | null = null;

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => pathname }));
vi.mock('../../lib/auth/auth-context', () => ({
  useAuth: () => ({ principal, ready: true, signOut }),
}));
vi.mock('../../lib/shop/shop-context', () => ({ useShop: () => shop }));
vi.mock('../../lib/shop/reads', () => ({
  useShopReads: () => ({ getStorefront: () => Promise.resolve(null) }),
}));
vi.mock('../../lib/api/http', () => ({ onUnauthorized: () => () => {} }));
vi.mock('../../lib/theme/theme-context', () => ({ useTheme: () => ({ mode: 'light' }) }));
vi.mock('../../components/shop-header', () => ({ ShopHeader: () => <div>header</div> }));
vi.mock('../../components/announcement-bar', () => ({ AnnouncementBar: () => null }));

import ShopShell from './layout';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ShopShell', () => {
  beforeEach(() => { push.mockClear(); signOut.mockClear(); principal = null; shop = null; pathname = '/products'; });

  it('sends a stranger on the platform host to login', async () => {
    render(<ShopShell><p>body</p></ShopShell>);
    await flush();
    expect(push).toHaveBeenCalledWith('/login');
  });

  it('lets a stranger browse a shop host', async () => {
    shop = { tenantId: 'acme' };
    const { findByText } = render(<ShopShell><p>body</p></ShopShell>);
    expect(await findByText('body')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('still protects the cart on a shop host', async () => {
    shop = { tenantId: 'acme' };
    pathname = '/cart';
    render(<ShopShell><p>body</p></ShopShell>);
    await flush();
    expect(push).toHaveBeenCalledWith('/login?next=%2Fcart');
  });

  it("signs out a session from another shop", async () => {
    shop = { tenantId: 'acme' };
    principal = { tenantId: 'globex', role: 'buyer' };
    render(<ShopShell><p>body</p></ShopShell>);
    await flush();
    expect(signOut).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** — FAIL (no `usePathname` use, no protected logic).

- [ ] **Step 3: Implement** — rewrite the top of `ShopShell`:

```tsx
const PROTECTED = ['/cart', '/orders', '/bookings'];
const isProtected = (pathname: string) => PROTECTED.some((p) => pathname.startsWith(p));

export default function ShopShell({ children }: { children: React.ReactNode }) {
  const { principal, ready, signOut } = useAuth();
  const { mode } = useTheme();
  const shop = useShop();
  const reads = useShopReads();
  const router = useRouter();
  const pathname = usePathname();
  const [config, setConfig] = useState<StorefrontConfig | null>(null);
  const [configReady, setConfigReady] = useState(false);

  useEffect(() => onUnauthorized(() => router.push('/login')), [router]);

  // A session from another shop is not a session here. Signed out rather
  // than tolerated: the token route it would use answers for its own tenant,
  // and a page half from one shop and half from another is worse than none.
  const foreign = Boolean(shop && principal && principal.tenantId !== shop.tenantId);
  useEffect(() => {
    if (foreign) signOut();
  }, [foreign, signOut]);

  // Who must sign in: everyone on the platform host, and anyone reaching for
  // a cart, an order or a booking on a shop host. Browsing a shop needs nobody.
  const needsSession = shop === null || (shop !== undefined && isProtected(pathname));
  const anonymous = ready && (!principal || foreign);
  useEffect(() => {
    if (shop === undefined || !ready) return;
    if (needsSession && anonymous) {
      router.push(shop ? `/login?next=${encodeURIComponent(pathname)}` : '/login');
    }
  }, [shop, ready, needsSession, anonymous, router, pathname]);

  useEffect(() => {
    if (shop === undefined || !ready) return;
    if (needsSession && anonymous) return;
    reads
      .getStorefront()
      .then(setConfig)
      // A failed fetch renders the default theme; the shop must not be down
      // because theming is.
      .catch(() => setConfig(null))
      .finally(() => setConfigReady(true));
  }, [shop, ready, needsSession, anonymous, reads]);

  if (shop === undefined || !ready || (needsSession && anonymous) || !configReady) return null;
```

The rest of the file is unchanged. Imports: `usePathname` from `next/navigation`, `useShop` from `../../lib/shop/shop-context`, `useShopReads` from `../../lib/shop/reads`; drop the `getPublishedStorefront` import.

- [ ] **Step 4: Run** — `pnpm --filter @marketplace/web exec vitest run app` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(web): a shop host opens to strangers; the platform host still asks for a session"`

---

### Task 8: Header, pages and login honour the anonymous visitor

**Files:**
- Modify: `apps/web/components/shop-header.tsx`, `shop-header.test.tsx`
- Modify: `apps/web/components/announcement-bar.tsx`, `more-from-shop.tsx`
- Modify: `apps/web/app/(shop)/products/page.tsx`, `products/[id]/page.tsx`, `events/page.tsx`, `events/[id]/page.tsx`
- Modify: `apps/web/app/login/page.tsx`

- [ ] **Step 1: Failing tests** — append to `shop-header.test.tsx` a second describe, overriding the auth mock per test with `vi.doMock` is awkward under a static `vi.mock`; instead make the mock read a mutable cell:

```tsx
let auth: { principal: { tenantId: string; role: string } | null; signOut: () => void } = {
  principal: { tenantId: 'acme', role: 'buyer' }, signOut: vi.fn(),
};
vi.mock('../lib/auth/auth-context', () => ({ useAuth: () => auth }));
```

then:

```tsx
describe('ShopHeader for a stranger', () => {
  it('offers Sign in and hides what needs a session', () => {
    auth = { principal: null, signOut: vi.fn() };
    renderWith(null);
    expect(screen.getByRole('link', { name: /Sign in/ })).toHaveAttribute('href', '/login?next=%2Fproducts');
    expect(screen.queryByRole('link', { name: 'Orders' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    auth = { principal: { tenantId: 'acme', role: 'buyer' }, signOut: vi.fn() };
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`shop-header.tsx`: split `LINKS` into `BROWSE = [PRODUCTS_LINK, EVENTS_LINK]` and `SESSION = [orders, bookings]`; `orderedLinks(sellsWhat, signedIn)` returns browse (ordered as now) plus `SESSION` only when `signedIn`. In the right-hand `Space`, when `!principal` render `<Link href={`/login?next=${encodeURIComponent(pathname)}`}><Button type="primary" icon={<LoginOutlined />}>{narrow ? null : 'Sign in'}</Button></Link>` and the cart button and theme toggle; the role chip and Sign out only when `principal`. Keep the label strings `Products`, `Events`, `Orders`, `Bookings` untouched.

`announcement-bar.tsx`: `const reads = useShopReads();` and `reads.getAnnouncement()` in the effect with `[reads]` deps. `more-from-shop.tsx`: `reads.listProducts(8, null)`, deps `[excludeId, reads]`.

`products/page.tsx`: `const reads = useShopReads(); const shop = useShop();` — `fetchPage` uses `reads.searchProducts` / `reads.listProducts` with `[reads]` deps; delete `SHOPPER_VISIBLE`/`onSale` and its comment (the engine filters public reads; on the platform host keep a one-line client filter for the token route: `const visible = shop ? page.items : page.items.filter((p) => p.status === 'active' || p.status === 'out_of_stock');` with the comment "The token route serves the cockpit too and returns every status; the public route already filtered."); hero gets `tenantId={shop?.tenantId ?? principal?.tenantId ?? ''}`.

`products/[id]/page.tsx`: `useResource(() => reads.getProduct(id), [id, reads])`; `const { principal } = useAuth(); const router = useRouter();` and the button's `onClick`:

```tsx
              onClick={() => {
                // A stranger is sent to sign in and brought straight back:
                // the cart is the buyer's, and there is no buyer yet.
                if (!principal) {
                  router.push(`/login?next=${encodeURIComponent(`/products/${product.id}`)}`);
                  return;
                }
                void add(product.id, qty).then(() => message.success(`${product.name} added to cart`));
              }}
```

`events/page.tsx`: `load={(cursor) => reads.listEvents(25, cursor)}`. `events/[id]/page.tsx`: `useResource(() => reads.getEvent(id), [id, reads])`; when `!principal`, in place of the `<Form>` render:

```tsx
            <Link href={`/login?next=${encodeURIComponent(`/events/${event.id}`)}`}>
              <Button type="primary" size="large" block disabled={soldOut}>
                {soldOut ? 'Sold out' : 'Sign in to book'}
              </Button>
            </Link>
```

`login/page.tsx`: `const params = useSearchParams(); const next = params.get('next'); const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/products';` and `router.push(target)`. Wrap the page body in `<Suspense>` if `next build` demands it for `useSearchParams` (Next 15 does for statically rendered pages): move the form into `LoginForm` and export `default function LoginPage() { return <Suspense fallback={null}><LoginForm /></Suspense>; }`.

- [ ] **Step 4: Run** — `pnpm --filter @marketplace/web test` → all green; `pnpm --filter @marketplace/web build` → clean (lint and types).

- [ ] **Step 5: Commit** — `git commit -m "feat(web): storefront pages read through the shop; strangers are sent to sign in only to buy"`

---

### Task 9: Journeys, stack run, screenshots

**Files:**
- Modify: `apps/web/test/e2e-journeys/run.mjs` (new section before the onboarding section)

- [ ] **Step 1: Add the section**

```js
// ===================================================== 10b. public storefront
section('A stranger at the door');

const SHOP_A = `http://${A}.localhost:3002`;
const SHOP_B = `http://${B}.localhost:3002`;
const strangerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const stranger = await strangerCtx.newPage();
stranger.on('response', (r) => {
  if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`);
});
let openMug;
let hiddenDraft;

await journey('the shop host shows the active product and not the draft, with no session', async () => {
  openMug = await createProduct({ name: `open-${RUN}`, status: 'active' });
  hiddenDraft = await createProduct({ name: `hidden-${RUN}`, status: 'draft' });
  await stranger.goto(`${SHOP_A}/products`);
  await stranger.getByText(openMug.name).first().waitFor({ timeout: 30_000 });
  const text = await stranger.locator('body').innerText();
  must(!text.includes(hiddenDraft.name), 'a draft is on the public shop');
  must(!stranger.url().includes('/login'), 'a stranger was sent to sign in just to look');
  must(await stranger.getByRole('link', { name: /Sign in/ }).count(), 'no Sign in offered');
  must((await stranger.getByRole('link', { name: 'Orders' }).count()) === 0, 'Orders shown to a stranger');
});

await journey('a stranger opening a product is sent to sign in only when they try to buy', async () => {
  await stranger.goto(`${SHOP_A}/products/${openMug.id}`);
  await stranger.getByRole('heading', { name: openMug.name }).waitFor({ timeout: 30_000 });
  await stranger.getByRole('button', { name: 'Add to cart' }).click();
  await stranger.waitForURL(/\/login\?next=/, { timeout: 30_000 });
  must(decodeURIComponent(stranger.url()).includes(`/products/${openMug.id}`), 'next does not point back');
});

await journey('the events list opens to a stranger', async () => {
  await stranger.goto(`${SHOP_A}/events`);
  await stranger.getByRole('heading', { name: 'Events' }).waitFor({ timeout: 30_000 });
  must(!stranger.url().includes('/login'), 'events sent a stranger to sign in');
});

await journey("the other shop's host shows none of this shop's products", async () => {
  await stranger.goto(`${SHOP_B}/products`);
  await stranger.waitForTimeout(2500);
  const text = await stranger.locator('body').innerText();
  must(!text.includes(openMug.name), "tenant A's product is on tenant B's host");
});

await journey("a buyer from another shop is signed out on this shop's host", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${SHOP_A}/login`);
  await page.getByLabel('Username').fill(B_ADMIN);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/products/, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  must(await page.getByRole('link', { name: /Sign in/ }).count(), 'a foreign session survived on the shop host');
  await ctx.close();
});

await journey('the public API answers without a token and hides the draft', async () => {
  const list = await fetch(`${ENGINE}/shops/${A}/products?limit=100`);
  must(list.status === 200, `public list answered ${list.status}`);
  const names = (await list.json()).items.map((p) => p.name);
  must(names.includes(openMug.name) && !names.includes(hiddenDraft.name), 'public list is wrong');
  const draft = await fetch(`${ENGINE}/shops/${A}/products/${hiddenDraft.id}`);
  must(draft.status === 404, `public draft read answered ${draft.status}`);
  const nope = await fetch(`${ENGINE}/shops/${A}/storefront/draft`);
  must(nope.status === 404, `storefront draft is public: ${nope.status}`);
});

await strangerCtx.close();
```

Also, in the onboarding section after the publish journey, add one journey that opens `http://${C}.localhost:3002/about` as a stranger and asserts the published About title is on the page.

- [ ] **Step 2: Rebuild web and engine, run journeys**

```
docker compose -f docker/docker-compose.yml up -d --build --force-recreate engine web
pnpm --filter @marketplace/web e2e:journeys
```

Expected: every existing journey still green plus the new section.

- [ ] **Step 3: Screenshots** — open `http://<published tenant>.localhost:3002/products` and `/about` in a fresh browser context, light and dark, look at them. Fix what looks wrong before continuing.

- [ ] **Step 4: Run the wider nets** — `pnpm --filter @marketplace/web test:e2e` (29 specs) and `npx turbo run test --concurrency=1`. Re-run any red suite alone before believing it.

- [ ] **Step 5: Commit** — `git commit -m "test(web): a stranger at the door — public storefront journeys"`

---

### Task 10: Status

**Files:**
- Create: `docs/STATUS-public-storefront.md`
- Modify: `docs/STATUS.md` (new dated entry at the top)

- [ ] **Step 1: Write** the status in the shape of `docs/STATUS-onboarding.md`: what shipped (engine, web), defects found, verification with suite counts, decisions worth remembering (tenant by host; public role; visible statuses in the query; bare host unchanged), and what the next slice is (guest cart, server rendering).

- [ ] **Step 2: Commit** — `git commit -m "docs: status for the public storefront"`
