# Grid Intelligence - frontend

Executive dashboard for the Grid Intelligence Platform. Next.js (App Router) +
TypeScript + Tailwind + Recharts, built as a **static export** for Cloudflare
Pages. All data is fetched **client-side** from the FastAPI backend - there is
no server runtime at request time.

## Stack

- Next.js 14 (App Router), `output: 'export'`
- TypeScript, Tailwind CSS 3
- Recharts for time-series charts
- Near-monochrome dark "Bloomberg-terminal" theme, one accent (calm blue)

## Getting started

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. With no backend running you'll see the loading then
error states; point `NEXT_PUBLIC_API_BASE` at a real API or run the [mock
API](#mock-api-ui-dev-without-the-backend) to see live data.

## Configuration

The API base URL is read from `NEXT_PUBLIC_API_BASE` (see `.env.local`). It is
**inlined at build time** and is public - never put secrets in it.

```
NEXT_PUBLIC_API_BASE=http://localhost:8787
```

The backend (`gridintel api`) binds `127.0.0.1:8787`. To develop against the
real Droplet API, open an SSH tunnel and leave the default value:

```bash
ssh -N -L 8787:127.0.0.1:8787 <user>@<droplet-ip>
```

### Mock API (UI dev without the backend)

To exercise the full UI - including the happy path for every tab - without the
Python platform, run the zero-dependency mock on `:8787`:

```bash
node scripts/mock-api.mjs            # synthetic but realistically-shaped /v1 data
DELAY=4000 node scripts/mock-api.mjs # add latency to see loading skeletons
```

It serves every `/v1/*` endpoint the dashboard reads, with permissive CORS.
Dev-only - not part of the build.

> **Deploy note:** on the Droplet, nginx currently proxies only the Streamlit
> dashboard at `grid.scottcampbell.io`. To use this frontend in production the
> FastAPI service needs a public origin (e.g. `https://api.grid.scottcampbell.io`)
> with CORS already open (`allow_origins=["*"]`). Set that URL as
> `NEXT_PUBLIC_API_BASE` in the Cloudflare Pages build environment.

## Build & deploy (Cloudflare Pages)

```bash
npm run build      # emits static site to ./out
```

Cloudflare Pages settings:

- Build command: `npm run build`
- Build output directory: `out`
- Environment variable: `NEXT_PUBLIC_API_BASE` = your public API origin

## Project layout

```text
src/
  app/
    layout.tsx      fonts, metadata/OG, global shell
    page.tsx        renders <Dashboard/>
    icon.svg        app icon / favicon
    globals.css     Tailwind base, :focus-visible ring, skeleton + reduced-motion
  components/
    Dashboard.tsx       shell: header + tab nav + active tabpanel; hash routing
    AppHeader.tsx       wordmark + product mark + freshness indicator
    LiveIndicator.tsx   Connecting / Live / Stale / Offline (from data age + error)
    TabNav.tsx          accessible tablist (roving focus, arrow keys, edge fades)
    Panel.tsx           bordered card with header
    PanelState.tsx      shared loading (skeleton) / error+retry / empty body
    Skeleton.tsx        gradient-sweep loading block (reduced-motion aware)
    Sparkline.tsx       dependency-free inline trend for headline KPIs
    KpiCard.tsx         big-number KPI + Delta + optional sparkline
    KpiRow.tsx          responsive 4-up grid
    DataTable.tsx       sortable, keyboard-operable table
    BaCompareSelect.tsx color-chip multi-select for BA comparison
    *Chart.tsx          Recharts views (Demand, Forecast, Stacked, HBar, TopBa, …)
    *Map.tsx            react-simple-maps weather maps (US + Europe)
    ErrorBanner.tsx     top-of-tab fetch-error banner with retry
    tabs/               one component per dashboard section (10 tabs)
  lib/
    api.ts          typed API client (string→number coercion, UTC parsing)
    format.ts       num(), parseUtc(), unit/percent/time formatters
    palette.ts      multi-series comparison palette
    status.ts       shared status palette (positive / caution / critical)
    types.ts        TabMeta (per-tab freshness reported up to the shell)
    useGridData.ts  client polling hooks + useNow() clock
    useTabRouting.ts hash <-> active-tab binding (deep-linkable, #forecast)
```

The 10 tabs (`Demand`, `Generation`, `Interchange`, `Anomalies`, `Forecast`,
`Weather`, `Europe`, `Europe Weather`, `Data Quality`, `Operations`) are all live
and URL-addressable via the hash (e.g. `#data-quality`).

## API endpoints

Each tab fetches client-side via the typed helpers in `lib/api.ts`. A summary:

| Tab            | Endpoints                                                        |
| -------------- | --------------------------------------------------------------- |
| Demand         | `/v1/demand/headline`, `/v1/demand/latest`, `/v1/generation/share`, `/v1/anomalies/recent` |
| Generation     | `/v1/generation/share`, `/v1/generation/mix`                    |
| Interchange    | `/v1/interchange/flows`                                         |
| Anomalies      | `/v1/anomalies/recent`                                          |
| Forecast       | `/v1/balancing-authorities`, `/v1/forecast/{ba}`, `/v1/forecast/accuracy` |
| Weather        | `/v1/weather/latest`                                            |
| Europe         | `/v1/europe/load`                                               |
| Europe Weather | `/v1/europe/weather`                                            |
| Data Quality   | `/v1/validation`                                                |
| Operations     | `/v1/freshness`, `/v1/ingest-runs`                              |

All numeric fields are coerced via `num()` because the API serializes Postgres
`numeric`/`Decimal` (and the `sec_since_*` epoch fields) as JSON strings.
