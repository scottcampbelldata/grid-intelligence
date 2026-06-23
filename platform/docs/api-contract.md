# Grid Intelligence Platform - API Contract

Reference for the FastAPI service (`gridintel/api/main.py`), intended as the spec
for a separate frontend (e.g. a Next.js/React app).

**This document is generated from the live API + source code; it does not change the API.**

---

## 1. Service overview

| Property | Value |
|---|---|
| Framework | FastAPI (`gridintel.api.main:app`), served by uvicorn |
| Title / version | "Grid Intelligence Platform - API" / `0.1.0` (from `gridintel.__version__`) |
| Base URL (current) | `http://127.0.0.1:8787` - **bound to localhost only** (systemd `ExecStart … --host 127.0.0.1 --port 8787`) |
| Auth | **None.** No API key, no cookies, no auth headers. |
| Methods | **GET only** (the API is read-only). |
| Content-Type | `application/json` |
| Timestamps | ISO-8601 UTC with `Z` suffix, e.g. `2026-06-19T10:00:00Z`. All times are UTC. |
| Versioned routes | All data endpoints are under `/v1/…`; `/healthz` is unversioned. |
| Port source | `GRIDINTEL_API_PORT` in `.env` (default `8787`). |

### CORS

CORS **is** configured and is wide open for browsers (see `main.py`):

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],     # any origin
    allow_methods=["GET"],   # GET only
    allow_headers=["*"],
)
```

So a static frontend served from any origin can call the API directly **once the
API is reachable**. Note `allow_origins=["*"]` with `allow_credentials` unset
(default `False`) is fine for this no-auth, public-data API.

### Binding / how to expose it for a frontend

The API currently listens on `127.0.0.1:8787` only - **not reachable from the
public internet.** To consume it from a deployed static frontend you have two
options:

1. **Reverse-proxy it through nginx** (recommended; matches how the dashboard is
   already exposed). Add a location to the existing `grid.scottcampbell.io`
   server block, e.g. proxy `https://grid.scottcampbell.io/api/` →
   `http://127.0.0.1:8787/`. The frontend then calls same-origin `/api/v1/…`
   (and you don't even need CORS in that case).
2. **Bind the service to `0.0.0.0`** and open the port in `ufw` - not
   recommended (exposes an unauthenticated service directly); prefer option 1.

---

## 2. Endpoint summary (13 endpoints)

| # | Method | Path | Purpose | Reads from |
|---|---|---|---|---|
| 1 | GET | `/healthz` | Liveness + DB check | `SELECT 1` |
| 2 | GET | `/v1/freshness` | Per-source ingestion freshness | `ops.source_freshness` |
| 3 | GET | `/v1/ingest-runs` | Recent ingestion run log | `ops.ingest_run` |
| 4 | GET | `/v1/balancing-authorities` | Distinct active BAs (last 7d) | `raw.demand` |
| 5 | GET | `/v1/demand/latest` | Hourly demand, last N hours | `raw.demand` |
| 6 | GET | `/v1/demand/headline` | "Grid right now" summary | `raw.demand` |
| 7 | GET | `/v1/generation/mix` | Generation by fuel over time | `raw.generation` |
| 8 | GET | `/v1/generation/share` | Per-fuel share + clean flags | `raw.generation` + `raw.fuel_type` |
| 9 | GET | `/v1/interchange/flows` | Net inter-BA flows | `raw.interchange` |
| 10 | GET | `/v1/anomalies/recent` | Flagged demand anomalies | `ml.demand_anomaly` |
| 11 | GET | `/v1/forecast/{ba_code}` | Actual + forecast for one BA | `raw.demand` + `ml.demand_forecast` |
| 12 | GET | `/v1/weather/latest` | Latest NOAA forecast per station | `raw.weather` |
| 13 | GET | `/v1/europe/load` | ENTSO-E European load | `raw.entsoe_load` |

> All reads hit base tables in the `raw` / `ml` / `ops` schemas directly - **none
> of these endpoints read the dbt marts** (`marts_*`). The dbt marts feed
> `scripts/export-marts.py` / PowerBI, not this API.

---

## 3. Cross-cutting type notes (read before building)

- **`value_mwh` / `value_mw` and most numeric measures are nullable** (`double
  precision` columns that can be `NULL`) → expect `number | null` in JSON.
- **`sec_since_fetch` and `sec_since_period` (endpoint `/v1/freshness`) are
  returned as JSON strings**, not numbers, because they come from
  `EXTRACT(EPOCH …)` (SQL `numeric`) which the driver serializes as strings.
  Example: `"sec_since_fetch": "1487.295748"`. The frontend must `parseFloat()`
  these. All other numeric measures - including `pct` on `/v1/generation/share`
  and every `value_mwh`/`value_mw` - are plain `double precision` and serialize as
  real JSON numbers.
- **Timestamps** are strings (ISO-8601, UTC, `Z`).
- **Empty result** is `[]` for list endpoints (HTTP 200), not 404.
- **Validation:** query params with `ge`/`le` bounds return **HTTP 422** if out of
  range (FastAPI validation), with a standard FastAPI error body.

---

## 4. Endpoint detail

### 1. `GET /healthz`
Liveness probe; runs `SELECT 1` against Postgres.

- **Params:** none.
- **Response `200`:** object
  | field | type | notes |
  |---|---|---|
  | `status` | string | `"ok"` |
  | `version` | string | API version, e.g. `"0.1.0"` |
- **On DB failure:** `503` with `{"detail": "db unavailable: …"}`.

```json
{ "status": "ok", "version": "0.1.0" }
```

---

### 2. `GET /v1/freshness`
Per-source freshness, one row per ingestion source.

- **Params:** none.
- **Reads:** `ops.source_freshness`.
- **Response `200`:** array of objects
  | field | type | notes |
  |---|---|---|
  | `source` | string | e.g. `EIA-fuel`, `EIA-region`, `EIA-interchange`, `ENTSOE-load`, `ENTSOE-gen`, `NOAA` |
  | `last_period_utc` | string (ts) \| null | newest data period seen |
  | `last_fetch_utc` | string (ts) \| null | when we last fetched |
  | `last_rows` | integer \| null | rows in last fetch |
  | `last_error` | string \| null | last error text |
  | `sec_since_fetch` | **string** (number) | seconds since last fetch - scheduler-health signal |
  | `sec_since_period` | **string** (number) | seconds since newest data period - source-latency signal |

```json
[
  {
    "source": "EIA-fuel",
    "last_period_utc": "2026-06-19T06:00:00Z",
    "last_fetch_utc": "2026-06-19T11:42:05.323538Z",
    "last_rows": 47317,
    "last_error": null,
    "sec_since_fetch": "1487.295748",
    "sec_since_period": "22012.619286"
  }
]
```

> Frontend tip: `sec_since_fetch` reflects **scheduler health** (small = ingesting
> on cadence); `sec_since_period` reflects **upstream publishing lag** (EIA/ENTSO-E
> publish with delay) - they are different things. Don't surface `sec_since_period`
> as "staleness".

---

### 3. `GET /v1/ingest-runs`
Recent ingestion-run log, newest first.

- **Params:**
  | name | in | type | default | bounds |
  |---|---|---|---|---|
  | `limit` | query | integer | `50` | `1`-`500` (422 if out of range) |
- **Reads:** `ops.ingest_run`.
- **Response `200`:** array of objects
  | field | type | notes |
  |---|---|---|
  | `source` | string | |
  | `started_at` | string (ts) | |
  | `finished_at` | string (ts) \| null | |
  | `rows_written` | integer | |
  | `status` | string | `running` \| `ok` \| `error` |
  | `error_message` | string \| null | |

```json
[
  {
    "source": "NOAA",
    "started_at": "2026-06-19T11:55:15.354612Z",
    "finished_at": "2026-06-19T11:55:15.354612Z",
    "rows_written": 4992,
    "status": "ok",
    "error_message": null
  }
]
```

---

### 4. `GET /v1/balancing-authorities`
Distinct BA codes with demand in the last 7 days (use to populate selectors).

- **Params:** none.
- **Reads:** `raw.demand` (`series='D'`, `period_utc > now()-7d`).
- **Response `200`:** array of objects
  | field | type |
  |---|---|
  | `ba_code` | string |

```json
[ { "ba_code": "AECI" } ]
```

---

### 5. `GET /v1/demand/latest`
Hourly demand rows across all BAs for the last N hours.

- **Params:**
  | name | in | type | default | bounds |
  |---|---|---|---|---|
  | `hours` | query | integer | `24` | `1`-`168` |
- **Reads:** `raw.demand` (`series='D'`).
- **Response `200`:** array of objects
  | field | type |
  |---|---|
  | `period_utc` | string (ts) |
  | `ba_code` | string |
  | `value_mwh` | number \| null |

```json
[ { "period_utc": "2026-06-18T13:00:00Z", "ba_code": "AECI", "value_mwh": 2168.0 } ]
```

---

### 6. `GET /v1/demand/headline`
One-shot "what's happening on the grid right now" summary (network totals + 24h delta).

- **Params:** none.
- **Reads:** `raw.demand` (last 48h window, internal LAG over 24 periods).
- **Response `200`:** object
  | field | type | notes |
  |---|---|---|
  | `as_of_utc` | string (ts) \| null | latest period used |
  | `total_mwh_now` | number \| null | sum across BAs at latest period |
  | `total_mwh_24h_ago` | number \| null | sum 24h earlier |
  | `bas` | integer | count of BAs contributing |
  | `delta_pct` | number \| null | %-change vs 24h ago (computed server-side) |

```json
{
  "as_of_utc": "2026-06-19T10:00:00Z",
  "total_mwh_now": 439621.0,
  "total_mwh_24h_ago": 428749.0,
  "bas": 49,
  "delta_pct": 2.5357493545174448
}
```

---

### 7. `GET /v1/generation/mix`
Generation summed by fuel per period, optionally filtered to one BA.

- **Params:**
  | name | in | type | default | bounds |
  |---|---|---|---|---|
  | `hours` | query | integer | `24` | `1`-`168` |
  | `ba_code` | query | string \| null | `null` | optional; filters to one BA |
- **Reads:** `raw.generation`.
- **Response `200`:** array of objects
  | field | type |
  |---|---|
  | `period_utc` | string (ts) |
  | `fuel_code` | string |
  | `value_mwh` | number \| null |

```json
[ { "period_utc": "2026-06-18T13:00:00Z", "fuel_code": "UNK", "value_mwh": 0.0 } ]
```

> `fuel_code` may include codes beyond the `raw.fuel_type` reference set (live EIA
> returns e.g. `PS`, `BAT`, `SNB`, `UNK`, `OES`, `WNB` in addition to
> `NG/NUC/COL/SUN/WND/WAT/OTH/GEO/OIL/BIO`).

---

### 8. `GET /v1/generation/share`
Per-fuel share of total generation over the window, with clean-energy flags.

- **Params:**
  | name | in | type | default | bounds |
  |---|---|---|---|---|
  | `hours` | query | integer | `24` | `1`-`168` |
- **Reads:** `raw.generation` LEFT JOIN `raw.fuel_type`.
- **Response `200`:** array of objects (ordered by `mwh` desc)
  | field | type | notes |
  |---|---|---|
  | `fuel_code` | string | |
  | `fuel_name` | string \| null | from `raw.fuel_type`; null if unmapped code |
  | `is_renewable` | boolean \| null | from `raw.fuel_type` |
  | `is_carbon_free` | boolean \| null | from `raw.fuel_type` |
  | `mwh` | number \| null | total MWh in window |
  | `pct` | number \| null | share of total, e.g. `37.95` (real JSON number) |

```json
[
  {
    "fuel_code": "NG",
    "fuel_name": "Natural Gas",
    "is_renewable": false,
    "is_carbon_free": false,
    "mwh": 3290306.0,
    "pct": 37.95033720179317
  }
]
```

---

### 9. `GET /v1/interchange/flows`
Net signed interchange aggregated per `(from_ba → to_ba)` pair.

- **Params:**
  | name | in | type | default | bounds |
  |---|---|---|---|---|
  | `hours` | query | integer | `24` | `1`-`168` |
- **Reads:** `raw.interchange`.
- **Response `200`:** array of objects (ordered by `abs(net_mwh)` desc)
  | field | type |
  |---|---|
  | `from_ba` | string |
  | `to_ba` | string |
  | `net_mwh` | number \| null |
  | `n_obs` | integer |

```json
[]
```

> Currently returns `[]` for a 24h window because EIA interchange data publishes
> with a large lag (latest period ~29h old at time of writing). Widen `hours` to
> backfill-cover it, or expect sparsity. Shape above is from the SQL.

---

### 10. `GET /v1/anomalies/recent`
Demand anomalies flagged by the ML job, strongest first.

- **Params:**
  | name | in | type | default | bounds |
  |---|---|---|---|---|
  | `hours` | query | integer | `48` | `1`-`168` |
- **Reads:** `ml.demand_anomaly` (`is_anomaly = true`).
- **Response `200`:** array of objects (ordered by `abs(z_score)` desc, then period desc)
  | field | type | notes |
  |---|---|---|
  | `period_utc` | string (ts) | |
  | `ba_code` | string | |
  | `actual_mwh` | number \| null | |
  | `expected_mwh` | number \| null | model baseline |
  | `residual_mwh` | number \| null | actual − expected |
  | `z_score` | number \| null | residual / rolling σ |
  | `severity` | string \| null | `info` \| `warn` \| `critical` |

```json
[
  {
    "period_utc": "2026-06-19T06:00:00Z",
    "ba_code": "PSCO",
    "actual_mwh": 0.0,
    "expected_mwh": 5407.930434618917,
    "residual_mwh": -5407.930434618917,
    "z_score": -4.193699247775106,
    "severity": "critical"
  }
]
```

---

### 11. `GET /v1/forecast/{ba_code}`
Realised demand (last 72h) + the latest forecast (fit within last 6h) for one BA.

- **Params:**
  | name | in | type | notes |
  |---|---|---|---|
  | `ba_code` | **path** | string | required, e.g. `PJM`, `AECI` |
- **Reads:** `raw.demand` (actual) + `ml.demand_forecast` (forecast).
- **Response `200`:** object
  | field | type | notes |
  |---|---|---|
  | `ba_code` | string | echoes the path param |
  | `actual` | array | `{ period_utc: ts, value_mwh: number\|null }` |
  | `forecast` | array | `{ period_utc: ts, yhat_mwh, yhat_lower, yhat_upper: number\|null, model_name: string }` |

```json
{
  "ba_code": "AECI",
  "actual": [ { "period_utc": "2026-06-16T13:00:00Z", "value_mwh": 1892.0 } ],
  "forecast": [
    {
      "period_utc": "2026-06-19T12:00:00Z",
      "yhat_mwh": 7196.92,
      "yhat_lower": 6526.57,
      "yhat_upper": 7867.26,
      "model_name": "SARIMAX(1,0,1)(1,0,1,24)"
    }
  ]
}
```

> Unknown/empty `ba_code` returns `200` with both arrays empty (no 404). `forecast`
> is empty unless an ML forecast was fit in the last 6 hours.

---

### 12. `GET /v1/weather/latest`
One NOAA row per station within `period_utc > now()-6h`, picking the **latest**
`period_utc` per station.

- **Params:** none.
- **Reads:** `raw.weather`.
- **Response `200`:** array of objects
  | field | type | notes |
  |---|---|---|
  | `station_id` | string | format `BA:<ba_code>`, e.g. `BA:AECI` |
  | `period_utc` | string (ts) | |
  | `temperature_c` | number \| null | |
  | `wind_speed_kph` | number \| null | |
  | `cloud_cover_pct` | number \| null | |
  | `short_forecast` | string \| null | e.g. `"Chance Showers And Thunderstorms"` |

```json
[
  {
    "station_id": "BA:AECI",
    "period_utc": "2026-06-25T22:00:00Z",
    "temperature_c": 27.78,
    "wind_speed_kph": 11.27,
    "cloud_cover_pct": 65.0,
    "short_forecast": "Chance Showers And Thunderstorms"
  }
]
```

> **Behavior note:** `raw.weather` stores NOAA *forecasts* (future-dated). Because
> the SQL orders `period_utc DESC` and takes the first per station, this returns
> the **furthest-out forecast hour** in the table (hence the `2026-06-25`
> timestamp), not the nearest-term forecast. Strip the `BA:` prefix from
> `station_id` to map back to a BA code.

---

### 13. `GET /v1/europe/load`
ENTSO-E actual load summed per bidding zone per period.

- **Params:**
  | name | in | type | default | bounds |
  |---|---|---|---|---|
  | `hours` | query | integer | `24` | `1`-`168` |
- **Reads:** `raw.entsoe_load`.
- **Response `200`:** array of objects
  | field | type | notes |
  |---|---|---|
  | `period_utc` | string (ts) | |
  | `bidding_zone` | string | **EIC area code**, e.g. `10YFR-RTE------C` (France), `10YES-REE------0` (Spain) - see note |
  | `value_mw` | number \| null | |

```json
[ { "period_utc": "2026-06-18T12:15:00Z", "bidding_zone": "10YAT-APG------L", "value_mw": 6702.0 } ]
```

> `bidding_zone` is a raw ENTSO-E **EIC code**, not a human name. The frontend will
> need a code→country/zone lookup. Codes currently present in live data: `10YAT-APG------L`
> (Austria), `10YBE----------2` (Belgium), `10YCH-SWISSGRIDZ` (Switzerland),
> `10YCZ-CEPS-----N` (Czechia), `10YDE-VE-------2` (Germany/50Hertz), `10YDK-1--------W`
> (Denmark DK1), `10YDK-2--------M` (Denmark DK2), `10YES-REE------0` (Spain),
> `10YFI-1--------U` (Finland), `10YFR-RTE------C` (France), `10YGR-HTSO-----Y`
> (Greece), `10YHU-MAVIR----U` (Hungary), `10YIE-1001A00010` (Ireland),
> `10YIT-GRTN-----B` (Italy), `10YNL----------L` (Netherlands), `10YNO-2--------T`
> (Norway NO2), `10YPL-AREA-----S` (Poland), `10YPT-REN------W` (Portugal),
> `10YSE-1--------K` (Sweden SE1).

---

## 5. Quick answers

- **Is CORS configured?** Yes - `allow_origins=["*"]`, `allow_methods=["GET"]`,
  `allow_headers=["*"]`. A browser frontend on any origin can call it.
- **Is the API bound to localhost only?** Yes - `127.0.0.1:8787` via the systemd
  unit. It is not publicly reachable yet. To expose it, reverse-proxy it through
  nginx (e.g. `https://grid.scottcampbell.io/api/` → `127.0.0.1:8787`) so the
  frontend can call same-origin `/api/v1/…`.
- **Auth?** None. Treat all data as public, read-only.
- **All 13 endpoints** listed in the README are covered above.
