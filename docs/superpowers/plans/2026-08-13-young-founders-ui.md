# Young Founders UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the platform into a bold, warm seller cockpit and a calm, credible storefront — light mode first — with an announcement bar, a founder onboarding checklist, and the craft defects from the 2026-08-13 capture review fixed.

**Architecture:** All colour continues to flow from `apps/web/lib/theme/tokens.ts` (one palette object, emitted as ANTD ThemeConfig + `--mp-*` CSS custom properties). The cockpit gets its own token slice in the same file and a nested ANTD `ConfigProvider` in the admin layout, so the two shells diverge without a second theming mechanism. The announcement bar is the one cross-stack piece: a NestJS `settings` module in the engine, a Zod contract in `@marketplace/contracts`, and a strip + editor in the web app.

**Tech Stack:** Next.js 15 app router, ANTD v5, Zod contracts, NestJS engine, DynamoDB single-table, Vitest (web unit), Jest (engine unit), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-08-13-young-founders-ui-design.md`

## Global Constraints

- Commits carry **no Claude attribution trailer** (user rule).
- Whole platform must pass e2e in local Docker Compose before the branch closes (user rule). The stack is already up; `ollama` is *not* running (port conflict with another project) — `chat.spec.ts` is expected to fail on `awaiting_confirmation` and that failure is pre-existing, not yours.
- Every visual change is verified by looking at captures, not only by green tests (user rule). Captures land in `apps/web/test-results/audit/`.
- WCAG AA is a hard gate: `zz-a11y.spec.ts` fails on serious/critical axe violations. Text never sits on the raw gradient; text-level greens are `#047857`-class.
- All new CSS variables keep the `--mp-` prefix — `tokens.test.ts` asserts every emitted key starts with it.
- `auth.spec.ts` asserts a buyer sees storefront links named exactly `Products`/`Orders` and none named `Flows`/`Chat`. Do not rename storefront nav links.
- Web unit tests: `pnpm --filter @marketplace/web test` (Vitest). Engine: `pnpm --filter @marketplace/engine test` (Jest). E2E: `pnpm --filter @marketplace/web test:e2e`. Typecheck: `pnpm --filter @marketplace/web exec tsc --noEmit`.
- Run against the running Docker stack (`localhost:3002`); after engine changes rebuild with `docker compose -f docker/docker-compose.yml up -d --build --no-deps engine`.

---

### Task 1: Light-first defaults, hero tokens, Select leak

**Files:**
- Modify: `apps/web/lib/theme/theme-context.tsx:31`
- Modify: `apps/web/app/layout.tsx:27-32`
- Modify: `apps/web/lib/theme/tokens.ts` (antdTheme `components`, cssVars hero vars)
- Modify: `apps/web/app/styles/components.css:287-329` (`.mp-hero` block)
- Test: `apps/web/lib/theme/tokens.test.ts`, `apps/web/lib/theme/theme-context.test.tsx`

**Interfaces:**
- Produces CSS vars later tasks consume: `--mp-hero-bg`, `--mp-hero-border`, `--mp-hero-ink`, `--mp-hero-muted`, `--mp-hero-eyebrow`.

- [ ] **Step 1: Write failing tests**

In `tokens.test.ts` add:

```ts
it('emits hero tokens that differ between themes', () => {
  const light = cssVars('light');
  const dark = cssVars('dark');
  expect(light['--mp-hero-bg']).toBeDefined();
  expect(light['--mp-hero-bg']).not.toBe(dark['--mp-hero-bg']);
  expect(light['--mp-hero-ink']).toBe('#0f172a');
  expect(dark['--mp-hero-ink']).toBe('#ffffff');
});

it('themes the Select dropdown from the palette, not ANTD blue', () => {
  const cfg = antdTheme('light');
  expect(cfg.components?.Select?.optionSelectedBg).toBe('rgb(13 148 136 / 10%)');
});
```

In `theme-context.test.tsx`, find the test covering the initial mode and update/add:

```tsx
it('defaults to light when nothing is stored, even if the system prefers dark', () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
  localStorage.clear();
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByTestId('mode').textContent).toBe('light');
});
```

(`Probe` — a tiny component reading `useTheme().mode` into a `data-testid="mode"` span — already exists in that test file in some form; reuse whatever probe it has.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @marketplace/web test -- theme`
Expected: FAIL — hero tokens undefined, Select components undefined, default resolves dark.

- [ ] **Step 3: Implement**

`theme-context.tsx` — light is the default for new visitors; the system preference no longer decides:

```tsx
// was: setModeState(stored === 'dark' || stored === 'light' ? stored : systemMode());
setModeState(stored === 'dark' || stored === 'light' ? stored : 'light');
```

Delete the now-unused `systemMode` helper. `app/layout.tsx` bootstrap keeps parity:

```ts
const THEME_BOOTSTRAP = `
(function(){try{
  var s=localStorage.getItem('marketplace.theme');
  document.documentElement.dataset.theme=(s==='dark'||s==='light')?s:'light';
}catch(e){}})();`;
```

`tokens.ts` — in `antdTheme`'s `components` add:

```ts
Select: {
  optionSelectedBg: dark ? 'rgb(13 148 136 / 16%)' : 'rgb(13 148 136 / 10%)',
  optionActiveBg: dark ? 'rgb(13 148 136 / 10%)' : 'rgb(13 148 136 / 6%)',
},
```

In `cssVars` add hero tokens:

```ts
'--mp-hero-bg': dark
  ? 'radial-gradient(120% 140% at 88% 0%, rgb(13 148 136 / 22%) 0%, transparent 55%), linear-gradient(135deg, #101c2e 0%, #0b1524 100%)'
  : 'radial-gradient(120% 140% at 88% 0%, rgb(13 148 136 / 14%) 0%, transparent 55%), linear-gradient(135deg, #f0fdfa 0%, #ffffff 100%)',
'--mp-hero-border': dark ? 'rgb(148 163 184 / 14%)' : 'rgb(15 118 110 / 20%)',
'--mp-hero-ink': dark ? '#ffffff' : '#0f172a',
'--mp-hero-muted': dark ? '#8ba0ba' : '#5c6a7d',
'--mp-hero-eyebrow': dark ? '#5eead4' : '#0f766e',
```

`components.css` `.mp-hero` block — replace the hard-coded values:

```css
.mp-hero {
  /* unchanged layout properties … */
  background: var(--mp-hero-bg);
  border: 1px solid var(--mp-hero-border);
}
.mp-hero-eyebrow { color: var(--mp-hero-eyebrow); }
.mp-hero h1 { color: var(--mp-hero-ink); }
.mp-hero-stat .v { color: var(--mp-hero-ink); }
.mp-hero-stat .k { color: var(--mp-hero-muted); }
```

(Only the colour declarations change; every layout declaration in those rules stays.)

- [ ] **Step 4: Verify pass + typecheck**

Run: `pnpm --filter @marketplace/web test -- theme && pnpm --filter @marketplace/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Look at it**

The web container runs a production build, so rebuild, then look:

```bash
docker compose -f docker/docker-compose.yml up -d --build --no-deps web
```

Sign in at `localhost:3002` (persona picker) — fresh browser profile should land **light**; `/products` hero must read as a light band with teal wash, not a dark slab. Toggle dark: hero returns to the dark gradient. Check the persona picker dropdown: hover/selected fill is teal-tinted, not blue.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): light by default, hero and dropdowns themed from tokens"
```

---

### Task 2: Cockpit palette — the seller's shell goes bold

**Files:**
- Modify: `apps/web/lib/theme/tokens.ts` (sidebar tokens become mode-aware; new accent/gradient vars; new `cockpitAntdTheme`)
- Modify: `apps/web/app/(admin)/layout.tsx` (nested ConfigProvider)
- Modify: `apps/web/app/styles/components.css` (sidebar rules consume vars; cockpit heading ink)
- Test: `apps/web/lib/theme/tokens.test.ts`

**Interfaces:**
- Produces: `cockpitAntdTheme(mode: Mode): ThemeConfig` exported from `tokens.ts`; CSS vars `--mp-accent` (`#047857`), `--mp-accent-soft` (light `#d1fae5` / dark `rgb(16 185 129 / 18%)`), `--mp-accent-bar` (`#10b981`), `--mp-grad` (`linear-gradient(90deg, #059669, #0284c7)`), `--mp-cockpit-ink` (light `#0c4a6e` / dark `#e6edf5`). Tasks 7 and 9 use `--mp-grad` and `--mp-accent`.

- [ ] **Step 1: Write failing tests**

```ts
it('gives the cockpit its own light sidebar and green primary', () => {
  expect(cssVars('light')['--mp-sidebar']).toBe('#eef4fb');
  expect(cssVars('dark')['--mp-sidebar']).toBe('#0f172a');
  expect(cockpitAntdTheme('light').token?.colorPrimary).toBe('#047857');
});

it('emits the cockpit accent set in both modes', () => {
  for (const mode of ['light', 'dark'] as const) {
    const vars = cssVars(mode);
    for (const key of ['--mp-accent', '--mp-accent-soft', '--mp-accent-bar', '--mp-grad', '--mp-cockpit-ink'])
      expect(vars[key]).toBeDefined();
  }
});
```

Import `cockpitAntdTheme` in the test header.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @marketplace/web test -- tokens`
Expected: FAIL — `cockpitAntdTheme` not exported, `--mp-sidebar` is `#0f172a` in light.

- [ ] **Step 3: Implement**

`tokens.ts`. Replace the four fixed `sidebar*` palette entries with a mode-aware block. Keep `palette` itself untouched except **remove** `sidebar`, `sidebarItem`, `sidebarText`, `sidebarTextStrong`, `sidebarAccent` from it, and add:

```ts
/**
 * The seller's cockpit. Light and warm where the storefront is calm: the
 * founder's own space can celebrate; the shop their customers see cannot.
 * Text-level greens are #047857-class -- the #10b981..#0ea5e9 gradient is
 * decoration and never carries text.
 */
const cockpit = {
  light: {
    sidebar: '#eef4fb',
    sidebarItem: '#dbe9f8',
    sidebarText: '#3b556e',
    sidebarTextStrong: '#0c223a',
    accent: '#047857',
    accentSoft: '#d1fae5',
    accentBar: '#10b981',
    ink: '#0c4a6e',
  },
  dark: {
    sidebar: '#0f172a',
    sidebarItem: '#1e293b',
    sidebarText: '#94a3b8',
    sidebarTextStrong: '#e2e8f0',
    accent: '#34d399',
    accentSoft: 'rgb(16 185 129 / 18%)',
    accentBar: '#34d399',
    ink: '#e6edf5',
  },
} as const;
```

In `cssVars`, replace the sidebar emissions and add the accent set:

```ts
const k = dark ? cockpit.dark : cockpit.light;
// …
'--mp-sidebar': k.sidebar,
'--mp-sidebar-item': k.sidebarItem,
'--mp-sidebar-text': k.sidebarText,
'--mp-sidebar-text-strong': k.sidebarTextStrong,
'--mp-sidebar-accent': k.accentBar,
'--mp-accent': k.accent,
'--mp-accent-soft': k.accentSoft,
'--mp-accent-bar': k.accentBar,
'--mp-grad': 'linear-gradient(90deg, #059669, #0284c7)',
'--mp-cockpit-ink': k.ink,
```

Add and export the cockpit ANTD theme — the storefront theme with the primary swapped:

```ts
/** The cockpit's ANTD slice: same bones, green primary. White on #047857 is 6.36:1. */
export function cockpitAntdTheme(mode: Mode): ThemeConfig {
  const base = antdTheme(mode);
  return {
    ...base,
    token: { ...base.token, colorPrimary: '#047857', colorLink: mode === 'dark' ? '#34d399' : '#047857' },
  };
}
```

`app/(admin)/layout.tsx` — wrap the shell in the nested provider:

```tsx
import { ConfigProvider } from 'antd';
import { cockpitAntdTheme } from '../../lib/theme/tokens';
import { useTheme } from '../../lib/theme/theme-context';
// inside AdminShell, above the return:
const { mode } = useTheme();
// wrap the existing JSX:
return (
  <ConfigProvider theme={cockpitAntdTheme(mode)}>
    <div className="mp-admin">{/* …existing content unchanged… */}</div>
  </ConfigProvider>
);
```

`components.css` — the sidebar block already consumes `--mp-sidebar*` vars for most rules; sweep the block (`components.css:137-254`) for the remaining hard-coded colours and replace:

- `.mp-sidebar-brand` `color: #fff !important` → `color: var(--mp-sidebar-text-strong) !important`
- `.mp-sidebar-label` `color: #8b9cb3` → `color: var(--mp-sidebar-text)`
- `.mp-sidebar-nav a[data-active]` `color: #fff !important` → `var(--mp-sidebar-text-strong) !important`
- `.mp-sidebar-foot` `border-top: 1px solid #1e293b` → `var(--mp-sidebar-item)`
- `.mp-sidebar-tenant` `border: 1px solid #26364d; color: #fff` → `border: 1px solid var(--mp-sidebar-item); color: var(--mp-sidebar-text-strong)`
- `.mp-sidebar-role` `color: #8b9cb3` → `var(--mp-sidebar-text)`

Cockpit headings — add after the `.mp-admin-main` rule:

```css
.mp-admin h1 {
  color: var(--mp-cockpit-ink);
}
```

Also `pages.css:327-335`: `.mp-admin` background gradient already uses `var(--mp-sidebar)` — no change needed there.

- [ ] **Step 4: Verify pass + typecheck**

Run: `pnpm --filter @marketplace/web test -- tokens && pnpm --filter @marketplace/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Look at it**

```bash
docker compose -f docker/docker-compose.yml up -d --build --no-deps web
```

As `acme-admin`, open `/admin/products` in light mode: light sidebar, dark-blue heading ink, green primary button. Toggle dark: dark sidebar returns, accents go spring-green. Storefront `/products` must be **unchanged** (teal primary).

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): the seller cockpit gets its own light-first palette"
```

---

### Task 3: Numbers align right; events say "2 of 50"

**Files:**
- Modify: `apps/web/app/(admin)/admin/products/page.tsx` (Price, Stock columns)
- Modify: `apps/web/app/(admin)/admin/events/page.tsx` (Starts/Capacity/Booked/Price columns)
- Modify: `apps/web/app/(shop)/events/page.tsx` (merge Capacity+Booked, align)
- Modify: `apps/web/app/(shop)/orders/page.tsx`, `apps/web/app/(shop)/bookings/page.tsx` (align any money/count columns — read each file, apply the same `align: 'right'` to columns whose `className` is already `mp-num`)
- Test: `apps/web/test/e2e/catalogue.spec.ts` (only if it asserts column text that changes — check first)

**Interfaces:** none new. Pattern: every ANTD column that renders money or a count gets `align: 'right' as const` and keeps `className: 'mp-num'`.

- [ ] **Step 1: Storefront events — merge the two columns**

In `app/(shop)/events/page.tsx` replace the `Capacity` and `Booked` column entries with one:

```tsx
{
  title: 'Booked',
  dataIndex: 'bookedCount',
  className: 'mp-num',
  align: 'right' as const,
  // One fact, one column: how full the session is.
  render: (booked: number, row) => `${booked} of ${row.capacity}`,
},
```

And add `align: 'right' as const` to the `Price` column.

- [ ] **Step 2: Admin tables**

`admin/products/page.tsx`: add `align: 'right' as const` to the `Price` and `Stock` columns.
`admin/events/page.tsx`: apply the same merge as Step 1 (identical column code) and right-align `Price`.

- [ ] **Step 3: Storefront orders and bookings**

Read both pages; for every column with `className: 'mp-num'` add `align: 'right' as const`. Do not change render logic.

- [ ] **Step 4: Check the e2e net**

Run: `grep -n "Capacity\|Booked" apps/web/test/e2e/*.spec.ts`
If any spec asserts the old two-column layout, update the assertion to the merged column (`getByRole('columnheader', { name: 'Booked' })`, cell text `2 of 50`).

- [ ] **Step 5: Verify**

Run: `pnpm --filter @marketplace/web exec tsc --noEmit && pnpm --filter @marketplace/web test`
Expected: PASS. Then rebuild web and eyeball `/admin/products` and `/events`: decimals share a right edge; events shows `2 of 50`.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): numbers align right, and a session says how full it is"
```

---

### Task 4: Placeholder tiles join the palette; cards go 4:3; cart gets thumbnails

**Files:**
- Modify: `apps/web/lib/placeholder.ts`
- Modify: `apps/web/lib/placeholder.test.ts`
- Modify: `apps/web/app/styles/components.css` (`.mp-card-media` ratio, `.mp-card-placeholder` size, `.mp-sk-media` padding)
- Modify: `apps/web/lib/cart/cart-context.tsx` (CartLine gains `image?`)
- Modify: `apps/web/app/(shop)/products/[id]/page.tsx` (pass `image` on add)
- Modify: `apps/web/app/(shop)/cart/page.tsx` (render thumbnail)
- Test: `apps/web/lib/placeholder.test.ts`

**Interfaces:**
- Produces: `CartLine.image?: string` — optional, so lines persisted in sessionStorage before this change still parse.

- [ ] **Step 1: Write failing placeholder test**

In `placeholder.test.ts` add:

```ts
it('draws every tile from the brand hue band, not the full wheel', () => {
  // Many ids; every gradient's hue must be one of the five palette hues.
  const allowed = new Set([158, 172, 199, 214, 244]);
  for (let i = 0; i < 50; i++) {
    const { gradient } = placeholderFor(`id-${i}`, 'Widget');
    const hues = [...gradient.matchAll(/hsl\((\d+) /g)].map((m) => Number(m[1]));
    expect(hues.length).toBeGreaterThan(0);
    for (const hue of hues) expect(allowed.has(hue)).toBe(true);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @marketplace/web test -- placeholder`
Expected: FAIL — hues are `hash % 360`, arbitrary.

- [ ] **Step 3: Implement**

`placeholder.ts` — replace the hue selection:

```ts
// Five hues from the brand's neighbourhood -- green, teal, cyan, blue, indigo.
// A tile can be any of these and still sit inside the page's palette; the old
// hash % 360 produced maroon and olive slabs that sat outside it.
const HUES = [158, 172, 199, 214, 244] as const;

export function placeholderFor(id: string, name: string): { gradient: string; initials: string } {
  const hue = HUES[hash(id) % HUES.length]!;
  const next = HUES[(hash(id) + 1) % HUES.length]!;
  // initials computation unchanged …
  return {
    gradient:
      `linear-gradient(135deg, hsl(${hue} var(--mp-placeholder-from)), ` +
      `hsl(${next} var(--mp-placeholder-to)))`,
    initials,
  };
}
```

`components.css`:

```css
.mp-card-media { aspect-ratio: 4 / 3; }           /* was 5 / 4 */
.mp-card-placeholder { font-size: 34px; }          /* was 26px */
.mp-sk-media { padding-bottom: 66%; }              /* was 72%, tracks 4:3 minus body */
```

`cart-context.tsx`:

```ts
export interface CartLine {
  productId: string;
  name: string;
  priceMinor: number;
  qty: number;
  /** First product image; absent for products without photographs. */
  image?: string;
}
```

`products/[id]/page.tsx` — in the `add()` call include `image: product.images[0]`.

`cart/page.tsx` — inside each `<li className="mp-line">`, before `mp-line-info`:

```tsx
{line.image ? (
  <img src={line.image} alt="" className="mp-table-thumb" />
) : (
  (() => {
    const { gradient, initials } = placeholderFor(line.productId, line.name);
    return (
      <span className="mp-thumb-placeholder" style={{ background: gradient }}>
        {initials}
      </span>
    );
  })()
)}
```

Import `placeholderFor` at the top. Update `.mp-line` grid in `pages.css` to make room:

```css
.mp-line { grid-template-columns: auto 1fr auto auto auto; }
```

(The narrow-viewport override at `pages.css:310-313` becomes `grid-template-columns: auto 1fr auto`.)

- [ ] **Step 4: Verify pass**

Run: `pnpm --filter @marketplace/web test && pnpm --filter @marketplace/web exec tsc --noEmit`
Expected: PASS (placeholder suite green, no type errors from CartLine).

- [ ] **Step 5: Look at it**

Rebuild web. `/products`: tiles are green/teal/blue family in both themes, mark fills the tile better, cards slightly shorter. Add an item to cart: thumbnail (or tile) leads each line.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): placeholder tiles join the palette, cards go 4:3, cart lines get a face"
```

---

### Task 5: The cockpit speaks money and plain language; the header earns its rows

**Files:**
- Modify: `apps/web/app/(admin)/admin/products/new/page.tsx` (money input, copy)
- Modify: `apps/web/app/(admin)/admin/events/new/page.tsx` (same money treatment — field name per that file, read it first)
- Modify: `apps/web/app/(admin)/admin/products/page.tsx`, `apps/web/app/(admin)/admin/flows/page.tsx` (jargon)
- Modify: `apps/web/components/shop-header.tsx` (role chip, narrow-screen labels)
- Modify: `apps/web/app/styles/components.css` (`.mp-role`, mobile header compaction)
- Test: `apps/web/test/e2e/catalogue.spec.ts` (references `Base price (minor units)` at :55 and possibly `Price (minor units)`)

**Interfaces:** none new.

- [ ] **Step 1: Money input on the new-product form**

`admin/products/new/page.tsx` — replace the `priceMinor` Form.Item:

```tsx
<Form.Item
  name="price"
  label="Price"
  rules={[{ required: true }]}
  // The engine speaks minor units; people don't. Convert at the boundary,
  // exactly as the storefront filter rail already does.
>
  <InputNumber min={0} step={0.01} precision={2} style={{ width: '100%' }} />
</Form.Item>
```

In `submit`, replace `priceMinor: values.priceMinor as number` with:

```ts
priceMinor: Math.round((values.price as number) * 100),
```

Replace the engine-excuse subtitle:

```tsx
<PageHeader title="New product" subtitle="Add photos now — they can't be changed after the product is created." />
```

- [ ] **Step 2: Same for the new-event form**

Read `admin/events/new/page.tsx`; it carries `Base price (minor units)` (see `catalogue.spec.ts:55`). Apply the identical pattern: field renamed to `basePrice`, label `Base price`, submit converts `basePriceMinor: Math.round((values.basePrice as number) * 100)`.

- [ ] **Step 3: Jargon sweep**

Run: `grep -rn "tenant\|catalogue" apps/web/app apps/web/components --include="*.tsx" | grep -iv "tenantId\|import\|//"`
Rewrite every user-facing string:
- `admin/products/page.tsx` subtitle `Everything in this tenant's catalogue` → `Everything in your shop`; caption `Products in this tenant's catalogue` → `Products in your shop`.
- `(shop)/events/page.tsx` empty description `This tenant has no events on sale. The catalogue is still open.` → `No events on sale yet. The products are still open.`
- Any other hits: same spirit — "your shop" / "this shop", never "tenant"/"catalogue". Code identifiers (`tenantId`) stay.

- [ ] **Step 4: Role chip + narrow header**

`shop-header.tsx` — replace `<Tag bordered={false}>{principal?.role ?? 'no role'}</Tag>` with:

```tsx
<span className="mp-role">{principal?.role ?? 'no role'}</span>
```

And make the two labelled buttons drop their text on narrow screens:

```tsx
import { Grid } from 'antd';
// in the component:
const screens = Grid.useBreakpoint();
const narrow = screens.sm === false;
// Cart button: {narrow ? null : 'Cart'} as the child; aria-label stays on the Link.
// Sign out button: {narrow ? null : 'Sign out'}; add aria-label="Sign out".
```

`components.css` — add near the tag styles:

```css
/* Who you are, not a status. Reads as a quiet label beside the controls. */
.mp-role {
  font-size: var(--mp-text-xs);
  font-weight: 620;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--mp-muted);
  padding: 2px 8px;
  border: 1px solid var(--mp-line);
  border-radius: var(--mp-radius-pill);
  background: var(--mp-surface-sunken);
}
@media (max-width: 767px) {
  .mp-role { display: none; }
}
```

- [ ] **Step 5: Update the e2e net**

`catalogue.spec.ts`: change `Base price (minor units)` to `Base price` and the typed value from minor units to major (e.g. `2500` → `25`); same for any `Price (minor units)` reference. Search: `grep -rn "minor units" apps/web/test`.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @marketplace/web test && pnpm --filter @marketplace/web exec tsc --noEmit`
Expected: PASS. Rebuild web; create a product at price `12.50` through the UI; storefront card must read `12.50 USD`. At 390px the header is brand + icon buttons on one row, nav strip on the second.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): the cockpit asks for money in money and drops the jargon"
```

---

### Task 6: Detail pages hold their weight

**Files:**
- Create: `apps/web/components/more-from-shop.tsx`
- Create: `apps/web/components/more-from-shop.test.tsx`
- Modify: `apps/web/app/(shop)/products/[id]/page.tsx`
- Modify: `apps/web/app/(shop)/events/[id]/page.tsx` (add the same row — read the file for its layout first)
- Modify: `apps/web/app/styles/pages.css` (`.mp-more` section)
- Modify: `apps/web/app/(shop)/events/page.tsx`, `orders/page.tsx`, `bookings/page.tsx` (narrow list container)

**Interfaces:**
- Produces: `MoreFromShop({ excludeId }: { excludeId: string })` — fetches `listProducts(8, null)`, filters out `excludeId`, renders up to 4 `ProductCard`s under an `h2` reading `More from this shop`. Renders `null` while loading, on error, or when nothing remains (a failed suggestion row is silence, never an error panel).

- [ ] **Step 1: Write failing component test**

`more-from-shop.test.tsx` (mirror the mocking style of `cursor-table.test.tsx` — Vitest + Testing Library):

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MoreFromShop } from './more-from-shop';

const product = (id: string) => ({
  entityType: 'Product', id, status: 'active', name: `P ${id}`, description: '',
  priceMinor: 1000, currency: 'USD', category: 'tools', stock: 3, images: [],
  createdAt: '', updatedAt: '', attributes: {},
});

vi.mock('../lib/api/products', () => ({
  listProducts: vi.fn().mockResolvedValue({
    items: [product('a'), product('b'), product('c')],
    nextCursor: null,
  }),
}));

describe('MoreFromShop', () => {
  it('shows the shop’s other products and never the one being viewed', async () => {
    render(<MoreFromShop excludeId="a" />);
    expect(await screen.findByText('P b')).toBeInTheDocument();
    expect(screen.queryByText('P a')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @marketplace/web test -- more-from-shop`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`components/more-from-shop.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { ProductResponse } from '@marketplace/contracts';
import { listProducts } from '../lib/api/products';
import { ProductCard } from './product-card';

/**
 * The shop's other work, under a detail page. Fills the dead half of the page
 * with the one thing a browsing customer actually wants next -- and quietly
 * disappears when the shop has nothing else, because an empty suggestion row
 * reads as a failed one.
 */
export function MoreFromShop({ excludeId }: { excludeId: string }) {
  const [items, setItems] = useState<ProductResponse[]>([]);

  useEffect(() => {
    let cancelled = false;
    listProducts(8, null)
      .then((page) => {
        if (!cancelled) setItems(page.items.filter((p) => p.id !== excludeId).slice(0, 4));
      })
      .catch(() => {
        /* a missing suggestion row is silence, not an error */
      });
    return () => {
      cancelled = true;
    };
  }, [excludeId]);

  if (items.length === 0) return null;

  return (
    <section className="mp-more" aria-label="More from this shop">
      <h2>More from this shop</h2>
      <div className="mp-grid mp-more-grid">
        {items.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
```

`pages.css`:

```css
/* The row that keeps a detail page from trailing off into blank viewport. */
.mp-more {
  margin-top: var(--mp-space-10);
  padding-top: var(--mp-space-6);
  border-top: 1px solid var(--mp-line);
}
.mp-more h2 {
  font-size: var(--mp-text-xs);
  font-weight: 640;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--mp-muted);
  margin-bottom: var(--mp-space-4);
}
.mp-more-grid {
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}

/* A one-row table floats in a full-width void; give short storefront lists a measure. */
.mp-list-measure { max-width: 980px; }
```

`products/[id]/page.tsx`: after the closing `</div>` of `.mp-detail`, add `<MoreFromShop excludeId={product.id} />` (import it).
`events/[id]/page.tsx`: read the file; add the same component after its main layout block, `excludeId=""` is wrong — events aren't products, so pass the literal `excludeId={''}` is meaningless; instead just render `<MoreFromShop excludeId={''} />`? No: **pass `excludeId={id}`** — the product list can never contain an event id, so nothing is filtered and the row simply shows the shop's products, which is the intent.

Storefront `events/page.tsx`, `orders/page.tsx`, `bookings/page.tsx`: wrap the `<CursorTable …/>` in `<div className="mp-list-measure">…</div>`.

- [ ] **Step 4: Verify pass**

Run: `pnpm --filter @marketplace/web test && pnpm --filter @marketplace/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Look at it**

Rebuild web. A product detail page now ends with the shop's other products; an event detail page likewise; `/events` with one row no longer spans the full window.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): detail pages end with the shop's other work, not blank viewport"
```

---

### Task 7: The founder's first screen

**Files:**
- Create: `apps/web/components/onboarding-checklist.tsx`
- Create: `apps/web/components/onboarding-checklist.test.tsx`
- Modify: `apps/web/app/(admin)/admin/products/page.tsx` (empty prop)

**Interfaces:**
- Produces: `OnboardingChecklist({ shopId }: { shopId: string })`. Rendered only as the products table's `empty` state, so "no products yet" is a precondition — step 2 is always the live step.

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingChecklist } from './onboarding-checklist';

describe('OnboardingChecklist', () => {
  it('greets the founder, marks the shop done, and points at the first listing', () => {
    render(<OnboardingChecklist shopId="acme" />);
    expect(screen.getByText('Your shop is ready')).toBeInTheDocument();
    expect(screen.getByText(/acme is live and yours/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'List a product' })).toHaveAttribute(
      'href',
      '/admin/products/new',
    );
    expect(screen.getByRole('button', { name: 'Copy shop link' })).toBeInTheDocument();
  });

  it('copies the storefront address', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<OnboardingChecklist shopId="acme" />);
    screen.getByRole('button', { name: 'Copy shop link' }).click();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/products`);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @marketplace/web test -- onboarding`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`components/onboarding-checklist.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { Button, message } from 'antd';
import { CheckOutlined, LinkOutlined } from '@ant-design/icons';

/**
 * The first screen that knows it is someone's first screen. Replaces the bare
 * "No products yet" empty state until the shop has a listing; the moment it
 * does, the products table takes over and this never appears again.
 */
export function OnboardingChecklist({ shopId }: { shopId: string }) {
  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/products`);
    void message.success('Shop link copied');
  };

  return (
    <div className="mp-onboard">
      <h2 className="mp-onboard-title">Your shop is ready</h2>
      <p className="mp-onboard-sub">Three steps between here and your first sale.</p>

      <ol className="mp-onboard-steps">
        <li data-done="true">
          <span className="mp-onboard-pip" aria-hidden="true">
            <CheckOutlined />
          </span>
          <span>
            <strong>Shop created</strong>
            <br />
            <span className="mp-onboard-desc">{shopId} is live and yours</span>
          </span>
        </li>
        <li>
          <span className="mp-onboard-pip" aria-hidden="true">2</span>
          <span>
            <strong>List your first product</strong>
            <br />
            <span className="mp-onboard-desc">A name, a photo and a price is enough</span>
          </span>
        </li>
        <li>
          <span className="mp-onboard-pip" aria-hidden="true">3</span>
          <span>
            <strong>Share your shop link</strong>
            <br />
            <span className="mp-onboard-desc">Anyone with it can buy from you</span>
          </span>
        </li>
      </ol>

      <div className="mp-onboard-actions">
        <Link href="/admin/products/new">
          <Button type="primary">List a product</Button>
        </Link>
        <Button icon={<LinkOutlined />} onClick={() => void copyLink()}>
          Copy shop link
        </Button>
      </div>
    </div>
  );
}
```

Styles, in `components.css` after the `.mp-empty` block:

```css
/* The founder's first screen. The gradient celebrates; the text stays on
   AA-checked solids. */
.mp-onboard {
  max-width: 560px;
  padding: var(--mp-space-8);
  background: var(--mp-surface-raised);
  border: 1px solid var(--mp-line);
  border-radius: var(--mp-radius-lg);
  box-shadow: var(--mp-shadow-sm);
}
.mp-onboard-title { font-size: var(--mp-text-xl); color: var(--mp-cockpit-ink); }
.mp-onboard-sub { margin: var(--mp-space-2) 0 var(--mp-space-5); color: var(--mp-muted); }
.mp-onboard-steps { list-style: none; margin: 0; padding: 0; }
.mp-onboard-steps li {
  display: flex;
  gap: var(--mp-space-3);
  padding: var(--mp-space-3) 0;
  border-bottom: 1px solid var(--mp-line);
}
.mp-onboard-steps li:last-child { border-bottom: 0; }
.mp-onboard-pip {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border-radius: 50%;
  border: 1px solid var(--mp-line-strong);
  color: var(--mp-muted);
  font-size: 12px;
  font-weight: 640;
}
.mp-onboard-steps li[data-done='true'] .mp-onboard-pip {
  background: var(--mp-grad);
  border: 0;
  color: #fff;
}
.mp-onboard-desc { color: var(--mp-muted); font-size: var(--mp-text-sm); }
.mp-onboard-actions { display: flex; gap: var(--mp-space-3); margin-top: var(--mp-space-5); }
```

`admin/products/page.tsx` — replace the `empty={<EmptyState …/>}` block:

```tsx
empty={<OnboardingChecklist shopId={principal?.tenantId ?? 'your shop'} />}
```

The page needs the principal: `const { principal } = useAuth();` (import `useAuth` from `../../../../lib/auth/auth-context`). Drop the now-unused `EmptyState` import.

- [ ] **Step 4: Verify pass**

Run: `pnpm --filter @marketplace/web test && pnpm --filter @marketplace/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Look at it**

Sign in as `globex-admin` (globex is seeded empty): `/admin/products` shows the checklist with the gradient pip. `acme-admin` with products sees the normal table.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): the first screen knows it's a founder's first screen"
```

---

### Task 8: Announcement — contract and engine module

**Files:**
- Create: `packages/contracts/src/settings.ts`, `packages/contracts/src/settings.test.ts`
- Modify: `packages/contracts/src/index.ts` (export)
- Create: `apps/engine/src/settings/settings.module.ts`, `settings.controller.ts`, `settings.service.ts`, `settings.service.test.ts`
- Modify: `apps/engine/src/app.module.ts` (import SettingsModule)
- Modify: `apps/engine/src/persistence/keys.ts` (settings sort key)

**Interfaces:**
- Produces (contracts): `AnnouncementSchema = z.object({ text: z.string().max(140), enabled: z.boolean() })`, types `Announcement`; `UpdateAnnouncementSchema` = same shape.
- Produces (engine): `GET /api/v1/settings/announcement` → `Announcement` (default `{ text: '', enabled: false }` when unset); `PUT /api/v1/settings/announcement` (admin role only, 403 otherwise) → stored `Announcement`.
- Produces (keys): `settingsSk(name: string): string` → `` `SETTINGS#${name}` ``.

- [ ] **Step 1: Contract + failing test**

`packages/contracts/src/settings.test.ts` (mirror `product.test.ts` style):

```ts
import { AnnouncementSchema } from './settings';

describe('AnnouncementSchema', () => {
  it('accepts a short line and a flag', () => {
    expect(AnnouncementSchema.parse({ text: 'Launch week', enabled: true })).toEqual({
      text: 'Launch week',
      enabled: true,
    });
  });

  it('rejects text past 140 characters', () => {
    expect(() => AnnouncementSchema.parse({ text: 'x'.repeat(141), enabled: true })).toThrow();
  });
});
```

`packages/contracts/src/settings.ts`:

```ts
import { z } from 'zod';

/** One line the seller controls on their own storefront. */
export const AnnouncementSchema = z.object({
  text: z.string().max(140),
  enabled: z.boolean(),
});
export type Announcement = z.infer<typeof AnnouncementSchema>;

export const UpdateAnnouncementSchema = AnnouncementSchema;
export type UpdateAnnouncement = Announcement;
```

Export from `index.ts`: `export * from './settings';`

Run: `pnpm --filter @marketplace/contracts test` → PASS (write test first, watch it fail on the missing module, then add the file).

- [ ] **Step 2: Keys helper + failing engine test**

`keys.ts` add:

```ts
export function settingsSk(name: string): string {
  return `SETTINGS#${name}`;
}
```

`apps/engine/src/settings/settings.service.test.ts` (Jest; repo and principal stubbed):

```ts
import { SettingsService } from './settings.service';

const repo = { get: jest.fn(), put: jest.fn() };

jest.mock('../common/tenant-context', () => ({
  currentPrincipal: jest.fn(() => ({ tenantId: 'acme', userId: 'u1', role: 'admin' })),
}));
import { currentPrincipal } from '../common/tenant-context';

describe('SettingsService', () => {
  const service = new SettingsService(repo as never);
  beforeEach(() => jest.clearAllMocks());

  it('defaults to a silent announcement when none is stored', async () => {
    repo.get.mockResolvedValue(null);
    await expect(service.getAnnouncement()).resolves.toEqual({ text: '', enabled: false });
  });

  it('stores and returns the seller’s line', async () => {
    repo.put.mockResolvedValue(undefined);
    await expect(
      service.updateAnnouncement({ text: 'Launch week', enabled: true }),
    ).resolves.toEqual({ text: 'Launch week', enabled: true });
    expect(repo.put).toHaveBeenCalledWith('SETTINGS#announcement', {
      text: 'Launch week',
      enabled: true,
    });
  });

  it('refuses a non-admin', async () => {
    (currentPrincipal as jest.Mock).mockReturnValueOnce({ tenantId: 'acme', userId: 'u1', role: 'buyer' });
    await expect(service.updateAnnouncement({ text: 'x', enabled: true })).rejects.toMatchObject({
      status: 403,
    });
  });
});
```

Run: `pnpm --filter @marketplace/engine test -- settings` → FAIL (module missing).

- [ ] **Step 3: Implement the module**

`settings.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Announcement, UpdateAnnouncement } from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { settingsSk } from '../persistence/keys';
import { ProblemException } from '../common/problem';
import { currentPrincipal } from '../common/tenant-context';

const ANNOUNCEMENT_SK = settingsSk('announcement');

@Injectable()
export class SettingsService {
  constructor(private readonly repo: DynamoRepository) {}

  /** Every signed-in user of the tenant may read it -- the storefront renders it. */
  async getAnnouncement(): Promise<Announcement> {
    const found = await this.repo.get<Announcement>(ANNOUNCEMENT_SK);
    // Absence is a state, not an error: a shop that has never set one is silent.
    return found ? { text: found.text, enabled: found.enabled } : { text: '', enabled: false };
  }

  async updateAnnouncement(input: UpdateAnnouncement): Promise<Announcement> {
    if (currentPrincipal().role !== 'admin')
      throw new ProblemException('forbidden', 403, 'Only an admin can set the announcement');
    await this.repo.put(ANNOUNCEMENT_SK, { text: input.text, enabled: input.enabled });
    return input;
  }
}
```

(Check `ProblemException`'s constructor order against `../common/problem.ts` before writing — `('not-found', 404, 'Product not found')` is the pattern seen in `products.service.ts:67`. Check `currentPrincipal`'s export exists in `../common/tenant-context` — it re-exports from `@marketplace/auth`.)

`settings.controller.ts`:

```ts
import { Body, Controller, Get, Put } from '@nestjs/common';
import { Announcement, UpdateAnnouncement, UpdateAnnouncementSchema } from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('announcement')
  getAnnouncement(): Promise<Announcement> {
    return this.settings.getAnnouncement();
  }

  @Put('announcement')
  updateAnnouncement(
    @ZodBody(UpdateAnnouncementSchema) body: UpdateAnnouncement,
  ): Promise<Announcement> {
    return this.settings.updateAnnouncement(body);
  }
}
```

(`ZodBody` import path per `products.controller.ts`.)

`settings.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
```

`app.module.ts`: import and add `SettingsModule` to `imports` after `FlowsModule`.

- [ ] **Step 4: Verify pass**

Run: `pnpm --filter @marketplace/contracts test && pnpm --filter @marketplace/engine test`
Expected: PASS, including the three new service tests.

- [ ] **Step 5: Prove it over HTTP**

```bash
docker compose -f docker/docker-compose.yml up -d --build --no-deps engine
```

Then with a dev token (personas endpoint pattern from e2e helpers — or simply defer HTTP proof to Task 9's e2e, which exercises the full path through the UI).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts apps/engine
git commit -m "feat(engine): a tenant announcement the seller controls"
```

---

### Task 9: Announcement — cockpit editor, storefront strip, e2e

**Files:**
- Create: `apps/web/lib/api/settings.ts`
- Create: `apps/web/app/(admin)/admin/settings/page.tsx`
- Create: `apps/web/components/announcement-bar.tsx`
- Modify: `apps/web/components/admin-sidebar.tsx` (nav entry)
- Modify: `apps/web/app/(shop)/layout.tsx` (render bar)
- Modify: `apps/web/app/styles/components.css` (`.mp-announce`)
- Create: `apps/web/test/e2e/announcement.spec.ts`

**Interfaces:**
- Consumes: engine endpoints from Task 8.
- Produces: `getAnnouncement(): Promise<Announcement>`, `putAnnouncement(body: Announcement): Promise<Announcement>` in `lib/api/settings.ts`.

- [ ] **Step 1: API client**

`lib/api/settings.ts` (pattern of `lib/api/products.ts`):

```ts
import { AnnouncementSchema, type Announcement } from '@marketplace/contracts';
import { request } from './http';

export const getAnnouncement = () =>
  request('/settings/announcement', { schema: AnnouncementSchema });

export const putAnnouncement = (body: Announcement) =>
  request('/settings/announcement', { method: 'PUT', body, schema: AnnouncementSchema });
```

- [ ] **Step 2: Write the failing e2e**

`test/e2e/announcement.spec.ts` (imports and helper use per `catalogue.spec.ts` / `helpers/session.ts`):

```ts
import { expect, test } from '@playwright/test';
import { signIn } from './helpers/session';

test('the seller sets an announcement and the storefront wears it', async ({ page }) => {
  await signIn(page, 'acme-admin');

  await page.goto('/admin/settings');
  await page.getByLabel('Announcement').fill('Launch week — 10% off');
  const toggle = page.getByRole('switch');
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Announcement saved')).toBeVisible();

  await page.goto('/products');
  await expect(page.getByText('Launch week — 10% off')).toBeVisible();

  // And off again — the strip must vanish, not linger.
  await page.goto('/admin/settings');
  await page.getByRole('switch').click();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.goto('/products');
  await expect(page.getByText('Launch week — 10% off')).not.toBeVisible();
});
```

Run: `pnpm --filter @marketplace/web exec playwright test announcement`
Expected: FAIL — `/admin/settings` does not exist.

- [ ] **Step 3: Cockpit editor page**

`app/(admin)/admin/settings/page.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { Button, Card, Form, Input, Switch, message } from 'antd';
import { getAnnouncement, putAnnouncement } from '../../../../lib/api/settings';
import { PageHeader } from '../../../../components/page-header';
import { notifyProblem } from '../../../../lib/problem-notify';

export default function AdminSettingsPage() {
  const [form] = Form.useForm();

  useEffect(() => {
    getAnnouncement()
      .then((a) => form.setFieldsValue(a))
      .catch(notifyProblem);
  }, [form]);

  const submit = async (values: { text: string; enabled: boolean }) => {
    try {
      await putAnnouncement({ text: values.text ?? '', enabled: values.enabled ?? false });
      void message.success('Announcement saved');
    } catch (err) {
      notifyProblem(err);
    }
  };

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="What your shop says for itself."
      />
      <Card className="mp-form-card" title="Announcement">
        <Form form={form} layout="vertical" onFinish={submit} initialValues={{ text: '', enabled: false }}>
          <Form.Item
            name="text"
            label="Announcement"
            extra="One line above your shop — a promotion, a holiday notice, anything current."
            rules={[{ max: 140 }]}
          >
            <Input maxLength={140} placeholder="Launch week — 10% off until Friday" />
          </Form.Item>
          <Form.Item name="enabled" label="Show it" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            Save
          </Button>
        </Form>
      </Card>
    </>
  );
}
```

`admin-sidebar.tsx` — add to `GROUPS` a fourth group (icons already imported set; add `SettingOutlined` import):

```ts
{
  label: 'Shop',
  items: [{ href: '/admin/settings', label: 'Settings', icon: <SettingOutlined /> }],
},
```

- [ ] **Step 4: Storefront strip**

`components/announcement-bar.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { Announcement } from '@marketplace/contracts';
import { getAnnouncement } from '../lib/api/settings';

/**
 * The seller's own line above their shop. Silent unless enabled and non-empty
 * -- and silent on error, because a shop must never wear a failure banner for
 * a feature this optional.
 */
export function AnnouncementBar() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  useEffect(() => {
    getAnnouncement().then(setAnnouncement).catch(() => setAnnouncement(null));
  }, []);

  if (!announcement?.enabled || !announcement.text.trim()) return null;

  return (
    <div className="mp-announce" role="status">
      {announcement.text}
    </div>
  );
}
```

`app/(shop)/layout.tsx` — render `<AnnouncementBar />` immediately before `<ShopHeader />` (import it).

`components.css`, near the shop header rules:

```css
/* The shop's own voice: one teal line, above everything, seller-controlled. */
.mp-announce {
  padding: 7px var(--mp-space-4);
  text-align: center;
  font-size: var(--mp-text-sm);
  font-weight: 560;
  color: #ecfeff;
  background: linear-gradient(90deg, var(--mp-primary-deep), var(--mp-primary));
}
```

(White-ish text on `#134e4a`→`#0f766e`: both clear 4.5:1.)

- [ ] **Step 5: Verify**

Run: `pnpm --filter @marketplace/web exec tsc --noEmit && pnpm --filter @marketplace/web test`
Rebuild web, then: `pnpm --filter @marketplace/web exec playwright test announcement`
Expected: PASS end to end.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): the shop speaks for itself - seller-set announcement bar"
```

---

### Task 10: Re-baseline, full verification, eye review

**Files:**
- Modify: `apps/web/test/e2e/zz-audit.spec.ts` / `zz-a11y.spec.ts` / `theme.spec.ts` / `responsive.spec.ts` — only where assertions encode pre-change facts (read each before touching; expected: little or nothing, since theme.spec is default-agnostic)
- Modify: `docs/superpowers/plans/2026-08-13-young-founders-ui.md` (record results)

- [ ] **Step 1: Full unit + typecheck sweep**

```bash
pnpm --filter @marketplace/web exec tsc --noEmit
pnpm --filter @marketplace/web test
pnpm --filter @marketplace/engine test
pnpm --filter @marketplace/contracts test
```

Expected: all green.

- [ ] **Step 2: Rebuild the full stack and run e2e**

```bash
docker compose -f docker/docker-compose.yml up -d --build --no-deps engine agents web
pnpm --filter @marketplace/web test:e2e
```

Expected: all specs green **except** `chat.spec.ts` (pre-existing: ollama not running in this environment — confirm the failure line is the `awaiting_confirmation` timeout and nothing else).

- [ ] **Step 3: Eye review of the audit captures**

Open from `apps/web/test-results/audit/` and answer each question. **Light first.**

| Capture | Question |
|---|---|
| `L-01` | Does the hero read as a light band that belongs on the page? Tiles palette-hued? |
| `L-02` | Does product detail end with "More from this shop" instead of blank viewport? |
| `L-03` | Do cart lines lead with a thumbnail or palette tile? |
| `L-04` | Does events show one `Booked` column reading `n of m`, right-aligned? |
| `L-10` | Light sidebar, blue-ink heading, green primary — and numbers right-aligned? |
| `L-12` | Does the form ask for `Price` in money? Is the subtitle free of engine excuses? |
| `X-03` | Does the empty admin state show the onboarding checklist? |
| `D-01`, `D-10` | Dark theme: hero still dark and composed; cockpit dark with green accents? |
| `M-01` | At 390: header = brand+icons row, nav strip row — nothing more? |
| Storefront after announcement e2e | Does the strip sit above the header, one line, teal? |

- [ ] **Step 4: Fix what looking finds**

Anything that reads wrong gets fixed and re-captured before this task closes. "Reviewed, nothing to fix" is a result — say it explicitly.

- [ ] **Step 5: Record results in this plan and commit**

```bash
git add -A
git commit -m "docs(plan): young founders UI - verification results and eye review"
```

---

## Self-Review

**Spec coverage.** §1 theme split → Tasks 1–2. §2 craft: alignment/merge → Task 3; tiles/ratio/cart thumbs → Task 4; role chip, mobile chrome, money input, copy → Task 5. §3 page weight → Task 6. §4 onboarding + jargon → Tasks 7, 5. §5 announcement → Tasks 8–9. §6 verification → Task 10 (plus per-task look-at-it steps). Out-of-scope list untouched.

**Placeholders.** None: every code step carries code; the two "read the file first" steps (admin events new-form field name; orders/bookings columns) name the exact transformation to apply, not a vague instruction.

**Type consistency.** `cockpitAntdTheme(mode)` defined in Task 2, consumed in Task 2 only. `--mp-grad`/`--mp-accent`/`--mp-cockpit-ink` defined Task 2, consumed Tasks 7 (`.mp-onboard`) and 2 (`.mp-admin h1`). `CartLine.image?` defined Task 4 and consumed in the same task. `Announcement`/`UpdateAnnouncement` defined Task 8, consumed in Task 9's client exactly as exported. `settingsSk('announcement')` produces `SETTINGS#announcement`, matching the service test's `repo.put` assertion. `OnboardingChecklist({ shopId })` matches its call site `shopId={principal?.tenantId ?? 'your shop'}`.

**Ordering.** Tasks 1→2 (tokens before cockpit consumers), 8→9 (engine before client). Tasks 3–7 are order-independent after 2. Task 10 last.
