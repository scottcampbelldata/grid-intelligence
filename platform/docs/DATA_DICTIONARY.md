# Data dictionary

Every table the platform writes or reads. Schemas: `raw`, `staging`, `marts`,
`ml`, `ops`. All time-series tables that exceed 1 row per second on average
are **TimescaleDB hypertables** partitioned by `period_utc`.

---

## `raw` - landing schema

Direct upsert targets of the ingestion jobs. One row per (period × natural key
× source).

### `raw.demand`  *(hypertable)*

Hourly demand, net generation, and total interchange per US balancing
authority, from EIA's `electricity/rto/region-data` endpoint.

| Column | Type | Notes |
|---|---|---|
| `period_utc` | `timestamptz` | hourly bucket, UTC |
| `ba_code`    | `text`        | EIA balancing-authority code, e.g. `PJM`, `MISO`, `ERCO` |
| `value_mwh`  | `double precision` | series value (MW averaged over the hour, reported as MWh) |
| `series`     | `text` | `D` = demand, `NG` = net generation, `TI` = total interchange |
| `source`     | `text` | `EIA` for live data, `DEMO` for seeded data |
| `inserted_at`| `timestamptz` | server-side load timestamp |

**PK:** `(period_utc, ba_code, series, source)`

### `raw.demand_forecast`  *(hypertable)*

EIA-published day-ahead demand forecast (series `DF`).

| Column | Type | Notes |
|---|---|---|
| `period_utc` | `timestamptz` | hour the forecast is for |
| `ba_code`    | `text` | |
| `value_mwh`  | `double precision` | forecast value |
| `source`     | `text` | `EIA` / `DEMO` |
| `inserted_at`| `timestamptz` | |

**PK:** `(period_utc, ba_code, source)`

### `raw.generation`  *(hypertable)*

Hourly net generation by BA × fuel type, from EIA's `fuel-type-data`.

| Column | Type | Notes |
|---|---|---|
| `period_utc` | `timestamptz` | |
| `ba_code`    | `text` | |
| `fuel_code`  | `text` | references `raw.fuel_type.fuel_code` |
| `value_mwh`  | `double precision` | MW averaged over the hour |
| `source`     | `text` | |
| `inserted_at`| `timestamptz` | |

**PK:** `(period_utc, ba_code, fuel_code, source)`

### `raw.interchange`  *(hypertable)*

Hourly net inter-BA flow, signed (positive = from `from_ba` to `to_ba`).

| Column | Type | Notes |
|---|---|---|
| `period_utc` | `timestamptz` | |
| `from_ba`    | `text` | |
| `to_ba`      | `text` | |
| `value_mwh`  | `double precision` | signed |
| `source`     | `text` | |
| `inserted_at`| `timestamptz` | |

**PK:** `(period_utc, from_ba, to_ba, source)`

### `raw.entsoe_load`  *(hypertable)*

ENTSO-E actual total load per bidding zone (document type `A65`, process
type `A16`).

| Column | Type | Notes |
|---|---|---|
| `period_utc`   | `timestamptz` | |
| `bidding_zone` | `text` | EIC area code, e.g. `10YDE-VE-------2` (Germany 50Hertz) |
| `value_mw`     | `double precision` | |
| `process_type` | `text` | always `A16` (realised) for this table |
| `source`       | `text` | `ENTSOE` / `DEMO` |
| `inserted_at`  | `timestamptz` | |

**PK:** `(period_utc, bidding_zone, process_type, source)`

### `raw.entsoe_generation`  *(hypertable)*

ENTSO-E actual generation per PSR (production source) type per bidding zone,
document type `A75`.

| Column | Type | Notes |
|---|---|---|
| `period_utc`   | `timestamptz` | |
| `bidding_zone` | `text` | |
| `psr_type`     | `text` | `B01..B20`; see `gridintel.ingest.entsoe.PSR_TYPE` |
| `value_mw`     | `double precision` | |
| `source`       | `text` | |
| `inserted_at`  | `timestamptz` | |

**PK:** `(period_utc, bidding_zone, psr_type, source)`

### `raw.weather`  *(hypertable)*

NOAA hourly gridded forecast at each tracked BA's centroid. `station_id`
follows the convention `BA:<ba_code>` (we proxy the BA centroid as the
"station" for join simplicity).

| Column | Type | Notes |
|---|---|---|
| `period_utc`     | `timestamptz` | |
| `station_id`     | `text` | e.g. `BA:PJM` |
| `temperature_c`  | `double precision` | from NOAA °F, converted |
| `wind_speed_kph` | `double precision` | from NOAA `"10 mph"` strings, parsed |
| `cloud_cover_pct`| `double precision` | NOAA `relativeHumidity.value` (proxy) |
| `short_forecast` | `text` | e.g. `"Mostly Sunny"` |

**PK:** `(period_utc, station_id)`

### `raw.fuel_type`

Static lookup, seeded at `init-db`. 10 rows.

### `raw.balancing_authority`

Static lookup, populated lazily as BAs are seen in `raw.demand`.

---

## `ops` - observability

### `ops.ingest_run`

One row per scheduled ingestion run, written at completion.

| Column | Type | Notes |
|---|---|---|
| `run_id`        | `bigserial` | |
| `source`        | `text` | e.g. `EIA-region`, `NOAA` |
| `started_at`    | `timestamptz` | |
| `finished_at`   | `timestamptz` | |
| `rows_written`  | `bigint` | |
| `status`        | `text` | `running` / `ok` / `error` |
| `error_message` | `text` | nullable |
| `payload`       | `jsonb` | optional per-source diagnostics |

### `ops.source_freshness`

One row per source. Updated on every successful run; powers the "Pipeline
health" tab and the dashboard's freshness pill.

| Column | Type | Notes |
|---|---|---|
| `source`          | `text` PK | |
| `last_period_utc` | `timestamptz` | newest `period_utc` we have for this source |
| `last_fetch_utc`  | `timestamptz` | when we last hit the upstream |
| `last_rows`       | `bigint` | rows from that fetch |
| `last_error`      | `text` | nullable |

---

## `marts` - analytical layer

Built by dbt and by the TimescaleDB continuous-aggregate policies.

* `marts.demand_hourly` - continuous aggregate of `raw.demand` (series `D`).
* `marts.demand_daily`  - continuous aggregate of `raw.demand` (series `D`).
* `marts.generation_hourly` - continuous aggregate of `raw.generation`.
* `marts.fct_demand_hourly` - dbt **incremental** model joining demand and
  forecast; computes `abs_forecast_error_pct`.
* `marts.fct_generation_hourly` - dbt incremental model enriching generation
  with fuel category and renewable / carbon-free flags.
* `marts.fct_interchange_hourly` - dbt incremental model of `raw.interchange`.
* `marts.agg_demand_recent` - last-72h per-BA KPI table for dashboard cards.
* `marts.agg_generation_mix_recent` - last-72h per-BA per-fuel shares.
* `marts.agg_renewable_share_network` - network-wide hourly renewable / carbon-
  free percentages.
* `marts.dim_balancing_authority` - BA dimension with surrogate key
  (`dbt_utils.generate_surrogate_key`) joining the seed CSV onto observed BAs.

---

## `ml` - model outputs  *(hypertables)*

### `ml.demand_forecast`

| Column | Type | Notes |
|---|---|---|
| `period_utc`  | `timestamptz` | hour being forecast |
| `ba_code`     | `text` | |
| `yhat_mwh`    | `double precision` | point forecast |
| `yhat_lower`  | `double precision` | 80% lower bound |
| `yhat_upper`  | `double precision` | 80% upper bound |
| `model_name`  | `text` | e.g. `SARIMAX(1,0,1)(1,0,1,24)` or `seasonal-naive-24h` |
| `fit_at_utc`  | `timestamptz` | when the model was fit |

**PK:** `(period_utc, ba_code, model_name)`

### `ml.demand_anomaly`

| Column | Type | Notes |
|---|---|---|
| `period_utc`   | `timestamptz` | |
| `ba_code`      | `text` | |
| `actual_mwh`   | `double precision` | |
| `expected_mwh` | `double precision` | baseline × diurnal |
| `residual_mwh` | `double precision` | `actual - expected` |
| `z_score`      | `double precision` | residual / rolling-std(168h) |
| `is_anomaly`   | `boolean` | `True` when `|z| ≥ 2` |
| `severity`     | `text` | `info` / `warn` / `critical` |

**PK:** `(period_utc, ba_code)`
