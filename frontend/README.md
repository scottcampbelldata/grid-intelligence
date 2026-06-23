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

Open http://localhost:3000.

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

```
src/
  app/
    layout.tsx      fonts + global shell
    page.tsx        Demand tab (the one built tab)
    globals.css     Tailwind + base styles
  components/
    AppHeader.tsx   title + LIVE indicator + "updated N min ago"
    LiveIndicator.tsx
    TabNav.tsx      8-tab nav (only Demand active)
    Panel.tsx       bordered card with header
    KpiCard.tsx     big-number KPI + Delta
    KpiRow.tsx      responsive 4-up grid
    DemandChart.tsx single-accent area/line chart
  lib/
    api.ts          typed API client (string→number coercion, UTC parsing)
    format.ts       num(), parseUtc(), unit/percent/time formatters
    useGridData.ts  client polling hook + useNow() clock
```

## Endpoints used by the Demand tab

| UI                     | Endpoint                          |
| ---------------------- | --------------------------------- |
| Network demand KPI     | `GET /v1/demand/headline`         |
| Generation 24h KPI     | `GET /v1/generation/share?hours=24` |
| Carbon-free share KPI  | `GET /v1/generation/share?hours=24` |
| Anomalies KPI          | `GET /v1/anomalies/recent?hours=24` |
| Hourly demand chart    | `GET /v1/demand/latest?hours=24`  |

All numeric fields are coerced via `num()` because the API serializes Postgres
`numeric`/`Decimal` (and the `sec_since_*` epoch fields) as JSON strings.
