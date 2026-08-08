# UI Craft Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the page-level conventions the web app already has but applies unevenly — headers on every list, a closed end to every list, identifiers demoted out of every primary column, a hero that uses its width, and a filter that speaks in money rather than subunits.

**Architecture:** No new pages and no new routes. One new presentational component (`Ref`), one new prop on `CursorTable`, and edits to six existing pages plus three stylesheets. Every change is client-side; the engine and the contracts are untouched.

**Tech Stack:** Next.js App Router (client components), TypeScript, Ant Design 5, plain CSS in `apps/web/app/styles/`, Vitest + Testing Library for unit tests, Playwright for e2e and screenshots.

## Global Constraints

- **No engine, route or contract changes.** `OrderResponseSchema` and `BookingResponseSchema` are `.strict()` and carry `productId` / `eventId` only. No titles may be added to either payload.
- **Cursor pagination gives no total.** Nothing may display or imply one. A count may only describe what is currently loaded, and only once `nextCursor` is `null`.
- **Ant Design stays.** Custom CSS extends and corrects it; no second component library.
- **Attribute fields are tenant-defined.** No layout may assume a field name, count or type.
- **Both themes, always.** Every visual change ships in light and dark or not at all.
- **Verification is by eye.** Passing tests prove behaviour; only looking at the screenshot proves appearance. See Task 9.
- **Spec:** `docs/superpowers/specs/2026-08-08-ui-craft-pass-design.md`.
- Run all commands from the repo root, `C:\Users\sathwik\projects\marketplace`.
- **Exact commands** (verified against `package.json` and `turbo.json` — there is no `typecheck` script, so `tsc` is invoked directly):
  - Unit tests: `pnpm --filter @marketplace/web test`
  - A single unit file: `pnpm --filter @marketplace/web test -- <name>`
  - Types: `pnpm --filter @marketplace/web exec tsc --noEmit`
  - Bring the stack up (seeded): `pnpm docker:up`
  - Playwright, whole suite: `pnpm --filter @marketplace/web test:e2e`
  - Playwright, one spec: `pnpm --filter @marketplace/web test:e2e -- <spec-name>`
  - Full docker-first run including engine and agents: `pnpm e2e`
- **Existing tokens only.** The muted ink is `--mp-muted` (there is no `--mp-ink-muted`). Monospace is the existing `.mp-id` class (`components.css:716`), which already sets the font stack, `--mp-text-xs` and `user-select: all` — there is no `--mp-font-mono` token. Do not introduce new token names.

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/components/ref.tsx` | **New.** Renders a ULID/UUID as a short, muted, copyable reference. Sole owner of how an identifier looks. |
| `apps/web/components/ref.test.tsx` | **New.** Unit tests for `Ref`. |
| `apps/web/components/cursor-table.tsx` | Gains a required `noun` prop and a terminal end-of-list line. |
| `apps/web/components/cursor-table.test.tsx` | Extended for the terminal state. |
| `apps/web/app/(shop)/orders/page.tsx` | Header; columns reordered; id demoted to `Ref`. |
| `apps/web/app/(shop)/bookings/page.tsx` | Header; `Event` column dropped; id demoted to `Ref`. |
| `apps/web/app/(shop)/events/page.tsx` | Header. |
| `apps/web/app/(shop)/bookings/[id]/page.tsx` | Resolves the event title; falls back to `Ref`. |
| `apps/web/app/(shop)/bookings/[id]/page.test.tsx` | **New.** Covers the resolved title and the fallback. |
| `apps/web/app/(admin)/admin/flows/page.tsx` | Columns reordered; flow id and `proposedBy` demoted to `Ref`. |
| `apps/web/app/(admin)/admin/products/page.tsx` | `noun` prop only. |
| `apps/web/app/(admin)/admin/events/page.tsx` | `noun` prop only. |
| `apps/web/components/storefront-hero.tsx` | Stats become a sibling of the text block. |
| `apps/web/components/filter-rail.tsx` | Price inputs take major units and convert on submit. |
| `apps/web/components/filter-rail.test.tsx` | **New.** Covers the major→minor conversion. |
| `apps/web/app/styles/components.css` | `.mp-ref`, `.mp-list-end`, hero axis, placeholder restyle. |
| `apps/web/app/styles/antd.css` | Duplicate `.mp-card-placeholder` block deleted. |
| `apps/web/test/e2e/catalogue.spec.ts` | Updated for the new filter label and units. |

---

### Task 1: The `Ref` component

A ULID is a reference, not a name. This component is the only place that decides how one looks, so the four call sites in Tasks 4 and 5 cannot drift.

**Files:**
- Create: `apps/web/components/ref.tsx`
- Create: `apps/web/components/ref.test.tsx`
- Modify: `apps/web/app/styles/components.css` (append `.mp-ref` rules)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Ref({ value: string, href?: string }): JSX.Element` — exported from `apps/web/components/ref.tsx`. Tasks 4 and 5 import it.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/ref.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Ref } from './ref';

describe('Ref', () => {
  it('shows the last six characters and keeps the whole value in the title', () => {
    render(<Ref value="01KZERNSB5VDM40BYKWA48W631" />);

    const el = screen.getByText('48W631');
    expect(el).toBeInTheDocument();
    // The full id has to stay reachable: it is what someone pastes into a
    // support ticket or a DynamoDB query.
    expect(el).toHaveAttribute('title', '01KZERNSB5VDM40BYKWA48W631');
  });

  it('renders a short value whole rather than padding or truncating it', () => {
    render(<Ref value="abc" />);
    expect(screen.getByText('abc')).toBeInTheDocument();
  });

  it('wraps in a link when given an href', () => {
    render(<Ref value="01KZERNSB5VDM40BYKWA48W631" href="/orders/01KZERNSB5VDM40BYKWA48W631" />);

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/orders/01KZERNSB5VDM40BYKWA48W631',
    );
    expect(screen.getByText('48W631')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @marketplace/web test -- ref.test`
Expected: FAIL — `Failed to resolve import "./ref"`.

- [ ] **Step 3: Write the component**

Create `apps/web/components/ref.tsx`:

```tsx
'use client';

import Link from 'next/link';

/** Enough to tell two rows apart by eye; short enough not to lead the row. */
const SHORT = 6;

/**
 * A ULID or UUID rendered as what it is: a reference, not a name.
 *
 * Lists used to lead with the full 26-character id, which made the widest and
 * loudest thing in every row the one thing no human recognises. The rule this
 * component exists to hold is that an identifier is muted, monospace, short,
 * and never the first column -- and that the full value stays one hover or one
 * copy away, because support tickets are written in whole ids.
 */
export function Ref({ value, href }: { value: string; href?: string }) {
  const short = value.length > SHORT ? value.slice(-SHORT) : value;
  // `mp-id` already owns the monospace stack and `user-select: all`, so a
  // double-click selects the whole reference. `mp-ref` only mutes it.
  const body = (
    <code className="mp-id mp-ref" title={value}>
      {short}
    </code>
  );

  return href ? (
    <Link href={href} className="mp-ref-link">
      {body}
    </Link>
  ) : (
    body
  );
}
```

- [ ] **Step 4: Add the styles**

Append to `apps/web/app/styles/components.css`:

```css
/* An identifier is a reference, not a name. `.mp-id` already supplies the
   monospace stack, the size and `user-select: all`; this only mutes it, so it
   never leads the row it sits in. */
.mp-ref {
  color: var(--mp-muted);
  white-space: nowrap;
}

.mp-ref-link .mp-ref {
  text-decoration: underline;
  text-underline-offset: 2px;
}
```

`--mp-muted` is the existing token (`lib/theme/tokens.ts:174`) and was checked for 4.5:1 in the previous accessibility pass. Do not invent `--mp-ink-muted`; it does not exist.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm --filter @marketplace/web test -- ref.test`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/ref.tsx apps/web/components/ref.test.tsx apps/web/app/styles/components.css
git commit -m "feat(web): a Ref component so an id reads as a reference"
```

---

### Task 2: Close the end of a list

A list that has loaded everything currently renders nothing where "Load more" was, so it looks identical to one still loading its last page.

**Files:**
- Modify: `apps/web/components/cursor-table.tsx`
- Modify: `apps/web/components/cursor-table.test.tsx`
- Modify: `apps/web/app/(shop)/orders/page.tsx`, `apps/web/app/(shop)/bookings/page.tsx`, `apps/web/app/(shop)/events/page.tsx`, `apps/web/app/(admin)/admin/flows/page.tsx`, `apps/web/app/(admin)/admin/products/page.tsx`, `apps/web/app/(admin)/admin/events/page.tsx` (add the required `noun` prop)
- Modify: `apps/web/app/styles/components.css` (append `.mp-list-end`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `CursorTable` gains a required prop `noun: { one: string; many: string }`. Every call site must pass it. Tasks 3 and 4 edit these same page files afterwards and assume `noun` is already present.

- [ ] **Step 1: Write the failing tests**

In `apps/web/components/cursor-table.test.tsx`, add `noun={{ one: 'row', many: 'rows' }}` to the `renderTable` helper's `<CursorTable>` and to the inline `rerender(...)` element in the `reloadToken` test. Then append these two cases inside the `describe`:

```tsx
  it('closes the list once the cursor runs out', async () => {
    const load = vi
      .fn<(cursor: string | null) => Promise<{ items: Row[]; nextCursor: string | null }>>()
      .mockResolvedValue({
        items: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        nextCursor: null,
      });

    renderTable(load);
    await act(async () => {});

    // Counting what is loaded is honest only because `done` is true: once the
    // cursor runs out, what is on the page is all there is.
    expect(screen.getByText('2 rows · end of list')).toBeInTheDocument();
    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('offers Load more instead of the end line while pages remain', async () => {
    const load = vi
      .fn<(cursor: string | null) => Promise<{ items: Row[]; nextCursor: string | null }>>()
      .mockResolvedValue({ items: [{ id: 'a', name: 'A' }], nextCursor: 'c1' });

    renderTable(load);
    await act(async () => {});

    expect(screen.getByText('Load more')).toBeInTheDocument();
    // "1 row · end of list" beside a Load more button would be a contradiction.
    expect(screen.queryByText(/end of list/)).toBeNull();
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm --filter @marketplace/web test -- cursor-table`
Expected: FAIL — the two new cases cannot find the end-of-list text. TypeScript will also flag the missing `noun` prop; that is expected until Step 3.

- [ ] **Step 3: Implement in `cursor-table.tsx`**

Add to the `Props<T>` interface, after `caption`:

```tsx
  /**
   * Names the rows in the end-of-list line. Required rather than defaulted to
   * "item": a default is how a page about bookings ends up saying "5 items".
   */
  noun: { one: string; many: string };
```

Add `noun` to the destructured parameters. Then replace the `{!done && (...)}` block at the end of the returned fragment with:

```tsx
      {!done ? (
        <Button
          style={{ marginTop: 'var(--mp-space-5)' }}
          loading={loading}
          onClick={() => void fetchPage(cursor, true)}
        >
          Load more
        </Button>
      ) : (
        <p className="mp-list-end">
          {items.length} {items.length === 1 ? noun.one : noun.many} · end of list
        </p>
      )}
```

This sits inside the branch that already returned early for the empty and error cases, so the line cannot render on an empty list.

- [ ] **Step 4: Add the style**

Append to `apps/web/app/styles/components.css`:

```css
/* A list that has ended should say so. Without this the last page is
   indistinguishable from a page still loading, and both trail off into blank
   page. */
.mp-list-end {
  margin: var(--mp-space-5) 0 0;
  font-size: var(--mp-text-xs);
  color: var(--mp-muted);
}
```

- [ ] **Step 5: Pass `noun` at all six call sites**

Add the prop next to the existing `caption`:

| File | Prop |
|---|---|
| `apps/web/app/(shop)/orders/page.tsx` | `noun={{ one: 'order', many: 'orders' }}` |
| `apps/web/app/(shop)/bookings/page.tsx` | `noun={{ one: 'booking', many: 'bookings' }}` |
| `apps/web/app/(shop)/events/page.tsx` | `noun={{ one: 'event', many: 'events' }}` |
| `apps/web/app/(admin)/admin/flows/page.tsx` | `noun={{ one: 'flow', many: 'flows' }}` |
| `apps/web/app/(admin)/admin/products/page.tsx` | `noun={{ one: 'product', many: 'products' }}` |
| `apps/web/app/(admin)/admin/events/page.tsx` | `noun={{ one: 'event', many: 'events' }}` |

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm --filter @marketplace/web test -- cursor-table`
Expected: PASS, 7 tests.

Run: `pnpm --filter @marketplace/web exec tsc --noEmit`
Expected: no errors. A missing `noun` at any call site fails here.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/cursor-table.tsx apps/web/components/cursor-table.test.tsx apps/web/app/styles/components.css "apps/web/app/(shop)" "apps/web/app/(admin)"
git commit -m "feat(web): tell the reader when a list has ended"
```

---

### Task 3: Headers on the three headerless lists

`/orders`, `/events` and `/bookings` render a bare table flush against the chrome. `/cart` and every admin page already use `PageHeader`.

**Files:**
- Modify: `apps/web/app/(shop)/orders/page.tsx`
- Modify: `apps/web/app/(shop)/events/page.tsx`
- Modify: `apps/web/app/(shop)/bookings/page.tsx`

**Interfaces:**
- Consumes: `PageHeader({ title: string, subtitle?: string, extra?: ReactNode })` from `apps/web/components/page-header.tsx` — already exists, unchanged.
- Produces: nothing new.

- [ ] **Step 1: Add the header to `/orders`**

In `apps/web/app/(shop)/orders/page.tsx`, add the import:

```tsx
import { PageHeader } from '../../../components/page-header';
```

Wrap the returned `<CursorTable …/>` in a fragment with the header above it:

```tsx
  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="Everything you have placed, at the prices they were locked at."
      />
      <CursorTable<OrderResponse>
        …unchanged…
      />
    </>
  );
```

No count in the subtitle: cursor pagination cannot supply one, and a count of what happens to be loaded changes when you press "Load more".

- [ ] **Step 2: Add the header to `/events`**

Same shape in `apps/web/app/(shop)/events/page.tsx`:

```tsx
      <PageHeader title="Events" subtitle="Sessions you can book a place at." />
```

Import path is `'../../../components/page-header'`.

- [ ] **Step 3: Add the header to `/bookings`**

Same shape in `apps/web/app/(shop)/bookings/page.tsx`:

```tsx
      <PageHeader title="Bookings" subtitle="Places you have reserved." />
```

Import path is `'../../../components/page-header'`.

- [ ] **Step 4: Typecheck and run the unit suite**

Run: `pnpm --filter @marketplace/web exec tsc --noEmit && pnpm --filter @marketplace/web test`
Expected: no type errors; the existing suite still passes.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(shop)/orders/page.tsx" "apps/web/app/(shop)/events/page.tsx" "apps/web/app/(shop)/bookings/page.tsx"
git commit -m "feat(web): name the three storefront lists that had no header"
```

---

### Task 4: Demote identifiers out of the primary column

**Files:**
- Modify: `apps/web/app/(shop)/orders/page.tsx`
- Modify: `apps/web/app/(shop)/bookings/page.tsx`
- Modify: `apps/web/app/(admin)/admin/flows/page.tsx`

**Interfaces:**
- Consumes: `Ref({ value, href? })` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Reorder the `/orders` columns**

In `apps/web/app/(shop)/orders/page.tsx`, add `import { Ref } from '../../../components/ref';` and replace the whole `columns` array with:

```tsx
      columns={[
        {
          // When an order happened is what a buyer recognises; its ULID is not.
          title: 'Placed',
          dataIndex: 'createdAt',
          render: (at: string, row) => <Link href={`/orders/${row.id}`}>{formatRelative(at)}</Link>,
        },
        {
          title: 'Status',
          dataIndex: 'status',
          render: (status: string) => <StatusTag status={status} />,
        },
        { title: 'Items', className: 'mp-num', render: (_, row) => row.items.length },
        {
          title: 'Total',
          dataIndex: 'totalAmountMinor',
          className: 'mp-num',
          render: (minor: number, row) => `${formatMoney(minor)} ${row.currency}`,
        },
        {
          title: 'Ref',
          dataIndex: 'id',
          render: (id: string) => <Ref value={id} />,
        },
      ]}
```

The link moves onto "Placed" so the row still has exactly one route into the record. `Ref` here takes no `href`: two links to the same place in one row is one too many.

- [ ] **Step 2: Rebuild the `/bookings` columns**

In `apps/web/app/(shop)/bookings/page.tsx`, add `import { Ref } from '../../../components/ref';` and replace the whole `columns` array with:

```tsx
      columns={[
        {
          title: 'Booked',
          dataIndex: 'createdAt',
          render: (at: string, row) => (
            <Link href={`/bookings/${row.id}`}>{formatRelative(at)}</Link>
          ),
        },
        {
          title: 'Status',
          dataIndex: 'status',
          render: (status: string) => <StatusTag status={status} />,
        },
        { title: 'Tickets', dataIndex: 'ticketQuantity', className: 'mp-num' },
        {
          title: 'Ref',
          dataIndex: 'id',
          render: (id: string) => <Ref value={id} />,
        },
      ]}
```

The `Event` column goes entirely. It held a second full ULID that named nothing; a row identifies one thing, not two, and the booking's detail page — which resolves the event's title in Task 5 — is one click away.

- [ ] **Step 3: Reorder the `/flows` columns**

In `apps/web/app/(admin)/admin/flows/page.tsx`, add `import { Ref } from '../../../../components/ref';` and replace the whole `columns` array with:

```tsx
        columns={[
          {
            // What the flow changes, which is what flow *detail* already leads
            // with since e66b7a6.
            title: 'Entity',
            dataIndex: 'targetEntity',
            render: (entity: string, row) => <Link href={`/admin/flows/${row.id}`}>{entity}</Link>,
          },
          {
            title: 'Adds',
            render: (_, row) => row.blueprintDiff.addedFields.map((f) => f.name).join(', '),
          },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (status: string) => <StatusTag status={status} />,
          },
          {
            title: 'Proposed by',
            dataIndex: 'proposedBy',
            // `system:agents` is already a name; only opaque ids get shortened.
            render: (by: string) => (by.includes(':') ? by : <Ref value={by} />),
          },
          {
            title: 'Ref',
            dataIndex: 'id',
            render: (id: string) => <Ref value={id} />,
          },
        ]}
```

- [ ] **Step 4: Typecheck and run the unit suite**

Run: `pnpm --filter @marketplace/web exec tsc --noEmit && pnpm --filter @marketplace/web test`
Expected: no type errors, suite green.

- [ ] **Step 5: Check the e2e suite does not select rows by id**

Run: `grep -rn "01KZ\|getByText(order\|orderId" apps/web/test/e2e/*.spec.ts`

If any spec locates a row by its full ULID text, update it to use the new leading column or the `Ref`'s `title` attribute. If nothing matches, note that and move on.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(shop)/orders/page.tsx" "apps/web/app/(shop)/bookings/page.tsx" "apps/web/app/(admin)/admin/flows/page.tsx"
git commit -m "feat(web): lead every list with something a human recognises"
```

---

### Task 5: Booking detail resolves its event

`D-09` reads `Event: 01KZERNS77Z1E2HB509WV80MN6` where a title belongs.

**Files:**
- Modify: `apps/web/app/(shop)/bookings/[id]/page.tsx`
- Create: `apps/web/app/(shop)/bookings/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `Ref` from Task 1; `useResource<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): { data, error, loading, retry }` from `apps/web/lib/use-resource.ts`; `getEvent(id: string): Promise<EventResponse>` from `apps/web/lib/api/events.ts`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/(shop)/bookings/[id]/page.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import BookingDetailPage from './page';

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'bkg-1' }) }));

const getBooking = vi.fn();
const getEvent = vi.fn();
vi.mock('../../../../lib/api/bookings', () => ({ getBooking: (id: string) => getBooking(id) }));
vi.mock('../../../../lib/api/events', () => ({ getEvent: (id: string) => getEvent(id) }));
vi.mock('../../../../lib/schemas/schema-cache', () => ({ useSchema: () => null }));

const BOOKING = {
  entityType: 'Booking',
  id: '01KZERNSCDRB5DFVYVK11QEX9N',
  eventId: '01KZERNS77Z1E2HB509WV80MN6',
  userId: 'u1',
  status: 'confirmed',
  ticketQuantity: 1,
  createdAt: '2026-08-08T00:14:00.000Z',
  attributes: {},
};

beforeEach(() => {
  getBooking.mockReset();
  getEvent.mockReset();
  getBooking.mockResolvedValue(BOOKING);
});

describe('BookingDetailPage', () => {
  it('names the event it booked rather than showing its id', async () => {
    getEvent.mockResolvedValue({ id: BOOKING.eventId, title: 'Ergonomics Clinic' });

    render(<BookingDetailPage />);
    await act(async () => {});

    expect(screen.getByText('Ergonomics Clinic')).toBeInTheDocument();
    expect(screen.queryByText(BOOKING.eventId)).toBeNull();
  });

  it('falls back to a reference when the event cannot be fetched', async () => {
    getEvent.mockRejectedValue(new Error('gone'));

    render(<BookingDetailPage />);
    await act(async () => {});

    // A missing event title must not take the booking down with it.
    expect(screen.getByText('Booking')).toBeInTheDocument();
    expect(screen.getByTitle(BOOKING.eventId)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @marketplace/web test -- bookings`
Expected: FAIL — the first case finds the raw id where the title should be.

- [ ] **Step 3: Resolve the event in the page**

In `apps/web/app/(shop)/bookings/[id]/page.tsx`:

Add imports:

```tsx
import type { BookingResponse, EventResponse } from '@marketplace/contracts';
import { getEvent } from '../../../../lib/api/events';
import { Ref } from '../../../../components/ref';
```

(`BookingResponse` is already imported — extend that import rather than adding a second one.)

Immediately after the existing `useResource` call and **before** any early return, add:

```tsx
  // Declared above the early returns: a hook cannot live after a conditional
  // `return`. Resolving one referenced record on a single-record page is a
  // different cost from resolving names across a whole list, which is why the
  // lists do not do this.
  const eventId = booking?.eventId ?? null;
  const { data: event } = useResource<EventResponse | null>(
    () => (eventId ? getEvent(eventId) : Promise.resolve(null)),
    [eventId],
  );
```

Then replace the `children` of the `event` description item with:

```tsx
              children: event ? (
                <Link href={`/events/${booking.eventId}`}>{event.title}</Link>
              ) : (
                <Ref value={booking.eventId} href={`/events/${booking.eventId}`} />
              ),
```

Delete the now-stale comment above it ("The booking carries an id and no title, so the link is the only way to find out what was booked") and replace it with:

```tsx
              // The booking payload carries an id and no title, so the title is
              // fetched. If that fails the reference still links through --
              // degraded, not broken.
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm --filter @marketplace/web test -- bookings`
Expected: PASS, 2 tests.

If the fallback case fails because `useResource` raised a toast, that is expected behaviour and not a test failure — `notifyProblem` renders through Ant Design's notification API, which is inert in jsdom. If it throws, mock `../../../../lib/problem-notify` in the test file with `{ notifyProblem: vi.fn() }`.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @marketplace/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(shop)/bookings/[id]/page.tsx" "apps/web/app/(shop)/bookings/[id]/page.test.tsx"
git commit -m "feat(web): name the event a booking is for"
```

---

### Task 6: The hero uses its width

`.mp-hero` is a flex row with one `flex: 1` child, so the tenant name and stats sit against the left edge of a full-width band and ~60% is gradient.

**Files:**
- Modify: `apps/web/components/storefront-hero.tsx`
- Modify: `apps/web/app/styles/components.css:287-349`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing new. The component's props are unchanged.

- [ ] **Step 1: Make the stats a sibling**

In `apps/web/components/storefront-hero.tsx`, change the returned JSX so `.mp-hero-stats` leaves `.mp-hero-text`:

```tsx
  return (
    <section className="mp-hero">
      <div className="mp-hero-text">
        <span className="mp-hero-eyebrow">
          <ShopOutlined /> Storefront
        </span>
        <h1>{tenantId}</h1>
      </div>

      {/* A sibling, not a child: as the only child of a flex row it left ~60%
          of the band empty. No product name here -- the grid below already
          renders every name, and repeating one makes "is this product on the
          page?" ambiguous. */}
      <div className="mp-hero-stats">
        <div className="mp-hero-stat">
          <span className="v">{show(products.length)}</span>
          <span className="k">Showing</span>
        </div>
        <div className="mp-hero-stat">
          <span className="v">{show(categories)}</span>
          <span className="k">{known && categories === 1 ? 'Category' : 'Categories'}</span>
        </div>
        <div className="mp-hero-stat">
          <span className="v">{show(inStock)}</span>
          <span className="k">In stock</span>
        </div>
      </div>
    </section>
  );
```

- [ ] **Step 2: Split the axis in CSS**

In `apps/web/app/styles/components.css`, add `justify-content: space-between;` to `.mp-hero` (line ~287), change `.mp-hero-text` from `flex: 1` to `flex: 0 1 auto;` (keep `min-width: 0`), and remove `margin-top: var(--mp-space-6);` from `.mp-hero-stats`.

The narrow breakpoint at line ~844 already sets `flex-direction: column; align-items: flex-start`, so the stacked mobile fallback needs no new rule — the stats drop beneath the name exactly as they do today. Confirm this rather than assuming it; Task 9's `M-01` capture is the proof.

- [ ] **Step 3: Typecheck and run the unit suite**

Run: `pnpm --filter @marketplace/web exec tsc --noEmit && pnpm --filter @marketplace/web test`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/storefront-hero.tsx apps/web/app/styles/components.css
git commit -m "feat(web): let the hero stats use the width they sit in"
```

---

### Task 7: One placeholder rule, and a stronger one

Two `.mp-card-placeholder` rules disagree at equal specificity; `antd.css` imports last and silently wins.

**Files:**
- Modify: `apps/web/app/styles/antd.css:48-53` (delete)
- Modify: `apps/web/app/styles/components.css:487-497`

**Interfaces:** none.

- [ ] **Step 1: Delete the duplicate, preserving what renders**

Remove this block from `apps/web/app/styles/antd.css` (lines 48–53, including its comment):

```css
/* The monogram is a fallback, not artwork -- let it recede. */
.mp-card-placeholder {
  font-size: 24px;
  font-weight: 620;
  opacity: 0.75;
}
```

Leave the `.mp-card[data-soldout='true']` block below it alone — it targets a different selector and is doing a job.

In `apps/web/app/styles/components.css`, change `.mp-card-placeholder`'s `font-size` to `24px` and `font-weight` to `620`, and add `opacity: 0.75;`. Nothing moves on screen: these are the values that were already winning. The point of this step is that there is now one place to change them.

- [ ] **Step 2: Verify nothing moved**

Run: `pnpm --filter @marketplace/web test`
Expected: green. Then rebuild and capture — this step's whole claim is "no pixel moved", and only a screenshot can support it:

```bash
pnpm docker:up
pnpm --filter @marketplace/web test:e2e -- zz-audit
```

Compare `D-01` and `L-01` against the versions committed before this task. If anything shifted, the values above are wrong — fix them to match what was rendering, do not adjust the design here.

- [ ] **Step 3: Now restyle deliberately**

Replace `.mp-card-placeholder` in `apps/web/app/styles/components.css` with:

```css
/* A tile without a photo, not a tile that failed. The monogram sits beside
   cards carrying full-bleed artwork, so it has to hold comparable weight --
   the blanket opacity was dimming the one element carrying the card's only
   information. */
.mp-card-placeholder {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--mp-placeholder-ink);
  text-decoration: none;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 6%);
}
```

- [ ] **Step 4: Look at it**

Rebuild and re-capture as in Step 2. Open `D-01` and `L-01` and judge one question: does a monogram card sit beside a photographed card without either looking broken? Light theme is the harder case — the `C`/`D`/`I` tiles were near-invisible there.

If it still reads as weak, adjust `--mp-placeholder-ink` or the inset shadow and look again. Do not proceed on the CSS alone.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/styles/antd.css apps/web/app/styles/components.css
git commit -m "fix(web): one placeholder rule, strong enough to sit beside a photo"
```

---

### Task 8: The filter speaks in money

`Min price (minor)` asks a shopper for currency subunits. Someone typing 899 meaning £899 filters for £8.99.

**Files:**
- Modify: `apps/web/components/filter-rail.tsx`
- Create: `apps/web/components/filter-rail.test.tsx`
- Modify: `apps/web/test/e2e/catalogue.spec.ts:13,21`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `FilterRail`'s `onApply` contract is unchanged — it still emits `priceMinorMin` / `priceMinorMax` in minor units. The conversion happens inside `RailForm`, so `apps/web/app/(shop)/products/page.tsx:76-77` needs no edit.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/filter-rail.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { FilterRail } from './filter-rail';

describe('FilterRail', () => {
  it('submits major units as minor units', async () => {
    const onApply = vi.fn();
    render(<FilterRail fields={null} onApply={onApply} onClear={vi.fn()} />);

    const min = screen.getByLabelText('Min price');
    await act(async () => {
      // ANTD's InputNumber is a text input under the hood.
      (min as HTMLInputElement).focus();
      (min as HTMLInputElement).value = '899';
      min.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      screen.getByText('Search').closest('button')!.click();
    });

    // 899 means £899, not 899 pence. The old control meant the second.
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ priceMinorMin: 89900 }),
    );
  });

  it('omits a price that was left blank rather than sending zero', async () => {
    const onApply = vi.fn();
    render(<FilterRail fields={null} onApply={onApply} onClear={vi.fn()} />);

    await act(async () => {
      screen.getByText('Search').closest('button')!.click();
    });

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ priceMinorMin: undefined, priceMinorMax: undefined }),
    );
  });
});
```

If driving ANTD's `InputNumber` this way proves unreliable in jsdom, use `@testing-library/user-event` (`await userEvent.type(min, '899')`) instead — check whether it is already a devDependency of `apps/web` before adding it, and if it is not, keep the native-event approach and adjust until the value registers.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @marketplace/web test -- filter-rail`
Expected: FAIL — `Unable to find a label with the text of: Min price` (the current label is `Min price (minor)`).

- [ ] **Step 3: Convert on submit**

In `apps/web/components/filter-rail.tsx`, above `RailForm`, add:

```tsx
/**
 * Minor units are a storage detail. A shopper types 899 meaning 899 pounds,
 * so the control takes major units and converts here -- the API contract
 * (`priceMinorMin`/`priceMinorMax`) is unchanged.
 *
 * The x100 convention matches `formatMoney`, which divides by the same. Both
 * are wrong for zero-decimal currencies such as JPY; that is a pre-existing
 * defect and out of scope here.
 */
const MINOR_PER_MAJOR = 100;

const toMinor = (value: unknown): number | undefined =>
  typeof value === 'number' ? Math.round(value * MINOR_PER_MAJOR) : undefined;
```

Replace the `onFinish={onApply}` on the `<Form>` with:

```tsx
      onFinish={({ priceMin, priceMax, ...rest }) =>
        onApply({
          ...rest,
          priceMinorMin: toMinor(priceMin),
          priceMinorMax: toMinor(priceMax),
        })
      }
```

Replace the two price `Form.Item`s and the comment above them with:

```tsx
      <Form.Item name="priceMin" label="Min price">
        <InputNumber min={0} style={{ width: '100%' }} placeholder="0" />
      </Form.Item>
      <Form.Item name="priceMax" label="Max price">
        <InputNumber min={0} style={{ width: '100%' }} placeholder="Any" />
      </Form.Item>
```

The deleted comment claimed the label was a contract that `catalogue.spec` depends on. It was; this task changes that contract deliberately and updates the spec in Step 4 of the same commit.

- [ ] **Step 4: Update the e2e spec**

In `apps/web/test/e2e/catalogue.spec.ts`, change line 21 from:

```ts
  await page.getByLabel('Min price (minor)').fill('90000');
```

to:

```ts
  await page.getByLabel('Min price').fill('900');
```

and update the comment at line 13 so it still describes what the numbers mean — the seeded product is `95_000` minor units, which is `950.00`, and the filter now takes major units, so `900` is the threshold below it.

Leave line 55 (`Base price (minor units)`) alone: that is the admin event form, a different control, and outside this pass. See "Follow-ups" at the end of this plan.

- [ ] **Step 5: Run the unit test and confirm it passes**

Run: `pnpm --filter @marketplace/web test -- filter-rail`
Expected: PASS, 2 tests.

- [ ] **Step 6: Run the e2e catalogue spec**

```bash
pnpm docker:up
pnpm --filter @marketplace/web test:e2e -- catalogue
```

Expected: PASS. A failure here means the filter is now sending the wrong magnitude — check what `onApply` emits before changing the test.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/filter-rail.tsx apps/web/components/filter-rail.test.tsx apps/web/test/e2e/catalogue.spec.ts
git commit -m "feat(web): ask for a price in money, not in subunits"
```

---

### Task 9: Look at all of it

The acceptance criterion for this whole plan. Tests prove behaviour; only looking proves appearance.

**Files:** none modified unless this task finds something.

**Interfaces:** none.

- [ ] **Step 1: Rebuild and run the full suite**

```bash
pnpm docker:up
pnpm --filter @marketplace/web exec tsc --noEmit
pnpm --filter @marketplace/web test
pnpm --filter @marketplace/web test:e2e
```

Expected: typecheck clean, unit suite green, e2e green including `zz-a11y` (which fails on serious and critical axe violations) and `zz-audit`.

- [ ] **Step 2: Review the affected captures by eye**

Open each of these from `apps/web/test-results/audit/` and check the stated question:

| Capture | Question |
|---|---|
| `D-01`, `L-01` | Does the hero fill its band? Do monogram and photographed cards sit at comparable weight, in both themes? |
| `D-04`, `L-04` | Does `/events` have a header, and does the list close? |
| `D-06`, `L-06` | Does `/orders` lead with "Placed"? Is the ULID now a quiet trailing `Ref`? |
| `D-08`, `L-08` | Does `/bookings` have a header, one identifier per row, and no `EVENT` column? |
| `D-09`, `L-09` | Does booking detail name the event? |
| `D-14`, `L-14` | Does `/flows` lead with Entity and Adds? Is `proposedBy` shortened, with `system:agents` left readable? |
| `M-01`, `T-01` | Do the hero stats stack beneath the name at 390 and 834? |
| `X-02` | Is the empty-orders state unchanged — no header-plus-empty-state collision? |

- [ ] **Step 3: Fix what looking finds**

Anything that reads wrong gets fixed and re-captured before this task is closed. Record what changed. If nothing needs fixing, say so explicitly rather than staying silent — "reviewed, nothing to fix" is a result.

- [ ] **Step 4: Commit any screenshot-driven fixes**

```bash
git add -A apps/web
git commit -m "fix(web): <what looking at the screenshots found>"
```

If Step 3 found nothing, skip this step.

---

## Follow-ups (not in this plan)

- **The chat page's empty proposal rail and card-in-card empty state** (`D-16`). Deferred by decision in the spec; wants its own pass.
- **`Base price (minor units)`** on the admin new-event form (`apps/web/test/e2e/catalogue.spec.ts:55`). The same vocabulary leak as Task 8, on the admin side. Not in the spec's scope; worth raising.
- **Zero-decimal currencies.** `formatMoney` and now `toMinor` both assume ×100, which is wrong for JPY. Pre-existing; unchanged by this plan.

## Self-Review

**Spec coverage.** Every section of `2026-08-08-ui-craft-pass-design.md` maps to a task: identity/demote-the-id → Tasks 1, 4; booking detail resolution → Task 5; page headers → Task 3; closing a list → Task 2; hero → Task 6; product placeholder → Task 7; filter vocabulary → Task 8; verification → Task 9. The spec's two deferred items are recorded under Follow-ups rather than dropped.

**Placeholders.** None. Every code step carries the code; every command step carries the command and its expected result.

**Type consistency.** `Ref({ value, href? })` is defined in Task 1 and used with exactly those props in Tasks 4 and 5. `noun: { one: string; many: string }` is defined in Task 2 and passed in that shape at all six call sites. `useResource` and `getEvent` are used in Task 5 with the signatures read from their source files. `FilterRail`'s external `onApply` contract is explicitly unchanged, which is why `products/page.tsx` appears in no task.

**Ordering.** Task 1 precedes 4 and 5 (they import `Ref`). Task 2 precedes 3 and 4 only by convention — they touch the same page files, so running them in order avoids conflicts. Task 7's two steps are deliberately sequenced: deduplicate with no visual change, verify by screenshot, then restyle.
