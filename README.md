# Grid Intelligence

Real-time electricity grid intelligence system. Monorepo containing the backend
platform and the dashboard frontend.

## Structure

| Folder | Stack | Role |
|--------|-------|------|
| [`platform/`](platform/) | Python 3.12 · FastAPI · PostgreSQL/TimescaleDB · statsmodels · dbt | Data ingestion, ML forecasting/anomaly detection, and the JSON API (port `8787`) |
| [`frontend/`](frontend/) | TypeScript · Next.js 14 · Tailwind · Recharts | Executive dashboard (static export → Cloudflare Pages) |

The frontend consumes the platform's `/v1/...` JSON API over HTTP. Set
`NEXT_PUBLIC_API_BASE` in the frontend to point at the platform API.

## Running locally

See each subproject's own README:

- [platform/README.md](platform/README.md) - backend setup, ingestion, API
- [frontend/README.md](frontend/README.md) - dashboard dev server and build

Typical flow: start the platform API on `:8787`, then run the frontend with
`NEXT_PUBLIC_API_BASE=http://localhost:8787`.
