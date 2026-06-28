# Frontend UX polish & hardening — design

**Date:** 2026-06-28
**Scope:** Tier 1 (UX correctness/feedback, a11y, nav) + Tier 2 (portfolio polish),
applied to the shared primitives and swept across all 10 tabs.
**Constraint:** Preserve the existing Bloomberg-terminal aesthetic — near-monochrome
dark palette, single blue accent (`#4f8bf5`), mono tabular numerals, hairline
dividers, restraint over semantic color. This is refinement, not a repaint.

## Problems (from code review + rendered audit)

1. **Loading / error / empty are conflated.** `loaded = lastUpdated !== null`, so a
   failed fetch leaves every panel showing "Loading…" forever while the error
   banner says it failed. A permanent failure is visually identical to a slow load.
2. **No skeletons.** Loading = bare centered text in 320px boxes; KPIs show a tiny
   ambiguous "-". Content pops in with layout shift. Reads cheap for a showcase.
3. **"Live" is dishonest.** Driven only by `!error`; shows "Live" before the first
   fetch resolves and stays "Live" when data is stale. No "Connecting…" state.
4. **A11y gaps remain:** no visible focus rings on dark; tab bar is not a real
   `tablist` (no arrow-key nav); animations ignore `prefers-reduced-motion`.
5. **Tabs aren't URL-addressable** (can't refresh into / share a tab); mobile tab
   bar scrolls with no affordance that 10 tabs exist.
6. **favicon 404 / no app identity / no social metadata.**
7. **Flat depth & rhythm** — competent but slightly templated; weak KPI hierarchy,
   abrupt empty/error framing, no micro-interactions.

## Approach

Centralize state rendering so all 10 tabs improve at once, then sweep tabs to use it.

### New shared primitives (`src/components/`)
- `Skeleton.tsx` — shimmer block respecting `prefers-reduced-motion`.
- `states.tsx` — `PanelMessage` (centered message used for empty/error/loading inside
  a panel at a consistent height) and chart/table skeletons.
- A single source of truth for panel body status: `loading` | `error` | `empty` | `ready`.

### Upgraded primitives
- **KpiCard:** skeleton value while loading; explicit "No data" (not a bare dash)
  when empty; slightly stronger numeric hierarchy; subtle hover/elevation.
- **Panel:** refined header rhythm, optional subtle elevation, graceful empty/error
  body via the shared state component instead of ad-hoc strings.
- **LiveIndicator → freshness:** three honest states — `Connecting…` (no data yet,
  no error), `Live` (fresh), `Stale Nm` / `Offline` (error or aged). Drives off
  `lastUpdated` age + `error`, not just `!error`.
- **AppHeader:** small product mark for identity; group freshness + status cleanly.

### Navigation
- **TabNav → accessible tablist:** `role="tablist"`/`tab`, roving `tabIndex`,
  Left/Right/Home/End arrow-key navigation, visible `focus-visible` ring.
- **URL sync:** active tab reflected in the URL hash (`#forecast`) — refreshable,
  shareable, back-button aware — via a small `useTabRouting` hook. Static-export safe.
- **Mobile:** edge-fade gradient on the scroll container as a scroll affordance.

### Global
- `globals.css`: `:focus-visible` ring tokens for dark bg; `@media
  (prefers-reduced-motion: reduce)` to disable ping/transitions; refined selection.
- `layout.tsx` / `app/icon.svg`: favicon/app icon (a minimal grid/signal mark) +
  richer `metadata` (OG/Twitter, themeColor).

### Verification harness
- `frontend/scripts/mock-api.mjs`: zero-dependency Node http server implementing the
  `/v1/*` endpoints with synthetic-but-realistic data, so the happy path can be run
  and screenshotted. Dev-only; not shipped.

## Out of scope (noted, not done now)
- Re-architecting the 10-tab IA into groups (US / Europe / System).
- Replacing Recharts or adding new chart types.
- Light mode / new palette.

## Success criteria
- No panel ever shows a perpetual "Loading…" after a failed fetch.
- Loading shows skeletons matching final layout (no jarring shift).
- Freshness indicator reflects real data age.
- Keyboard: full tab navigation with visible focus; reduced-motion respected.
- Tabs are URL-addressable; mobile nav shows it scrolls.
- `next build` passes; before/after screenshots captured at desktop + mobile.
