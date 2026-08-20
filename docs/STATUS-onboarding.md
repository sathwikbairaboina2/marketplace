# Owner onboarding and storefront theming — status

**Date:** 2026-08-20 · **Branch:** `feat/owner-onboarding`
**Spec:** `docs/superpowers/specs/2026-08-20-owner-onboarding-storefront-theming-design.md`
**Plan:** `docs/superpowers/plans/2026-08-20-owner-onboarding-storefront-theming.md`

## What shipped

A first-login wizard in the cockpit where an agent interviews the owner about
their business and generates the storefront presentation: one of five preset
themes with bounded tuning, an About page, and up to three banners. The owner
watches a live preview, edits copy in place, uploads or (optionally) generates
banner photos, and publishes explicitly. Customers see nothing until publish.

- **Contracts** — `packages/contracts/src/storefront.ts`: `StorefrontConfig`
  (preset id + `ThemeOverrides` + about + banners + business profile), with a
  WCAG contrast refinement so an unreadable accent cannot be stored by anyone,
  agent included. Agent protocol gains thread kinds and an onboarding snapshot.
- **Engine** — `storefront` module: draft + published config as two settings
  items per tenant; `GET /storefront` (enveloped `{ config }`), admin
  draft/publish routes, onboarding-dismissed flag, and optional
  `POST /storefront/banner-art` (ComfyUI behind `IMAGE_GEN_URL`, off by
  default — the project still stands alone).
- **Agents** — a second LangGraph beside the schema graph: profileCheck →
  proposeTheme → draftContent → assembleDraft → dispatchDraft, with feedback
  messages re-entering the generate path. Same checkpointer, same gateway,
  routed by the thread's kind. Dispatch writes the draft with the owner's own
  token; publish is never the agent's to do.
- **Web** — five presets (`artisan`, `tech`, `editorial`, `market`, `studio`)
  beside the token system; `resolveTheme` maps config → the existing CSS
  variable set, applied on the `(shop)` wrapper only (the cockpit is never
  themed). New `/about` route and banner slots on the storefront. Wizard at
  `/admin/onboarding` (chat left, preview right), first-login redirect,
  re-entry from Settings → Store design.

## Defects the verification caught

1. **Empty 200 for "no config"** — Nest serializes a bare `null` return as a
   zero-byte body; every JSON client threw and the first-login redirect
   silently never fired. Found by the onboarding journeys, fixed with the
   `{ config }` envelope.
2. **Default page margins under a themed shop** — `.mp-shop` carried the
   tenant variables but painted no background, so the body's default surface
   showed through. Found only in the preset screenshots.
3. **Table keys leaking into a strict parse** — stored configs come back with
   `PK`/`SK`, which the strict schema rejected as a 500 on first e2e contact.

## Verification (all on 2026-08-20)

- `npx turbo run test --concurrency=1` — 10/10 packages (contracts 146,
  engine unit incl. storefront + image-gen, agents 109 incl. onboarding graph
  int-test on scripted LLM, web 219).
- Engine e2e — 14 suites, 114 tests, including the new `storefront.e2e` suite.
- Browser journeys — **78/78**, five new: fresh-owner redirect, conversation →
  draft (real ollama, structural assertions), publish → themed storefront +
  about + hero for a buyer, re-entry from settings, skip-and-stay-skipped.
- UI campaign — see `docs/STATUS.md` entry for the run result.
- Screenshots — all five presets, home + about, light and dark, rendered and
  looked at; defect 2 above came from this pass and was re-shot clean.
- `pnpm --filter @marketplace/web build`, `nest build` engine + agents — clean.

## Decisions worth remembering

- Presets are code, not data: the table stores choices, so a palette fix ships
  without a migration. `PRESET_SURFACES` in contracts pins the one slice
  validation needs, and a web test pins presets.ts to it.
- The accent rule is split: contracts enforce the fill case (white text at
  4.5:1); resolve-time falls back to the preset's own text accent when the
  override cannot serve as text on a surface. One hex can't clear both modes.
- Journey and campaign tenants dismiss the wizard in setup — the same act a
  real owner's Skip performs — because a fresh tenant now opens on it.
- Image generation degrades to absent: unset `IMAGE_GEN_URL` (the committed
  default) hides the button and flips the capability flag; CSS banner art
  always works.
