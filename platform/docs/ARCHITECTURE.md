# Architecture

Deep dive into how the platform is wired together. The headline diagram lives
in the [main README](../README.md#%EF%B8%8F-architecture); this document is
the longer-form rationale for the senior reviewer.

---

## Why these choices

### TimescaleDB on Postgres 17 (not Snowflake / Cassandra / Influx)

* The data is **strict time-series with high cardinality on a small dim set
  (BA × fuel × period)**. Timescale's hypertable + continuous-aggregate model
  is the right shape - and lets every downstream tool that speaks SQL Just
  Work, including dbt.
* I run on a single Windows box with no admin and no Docker; Timescale's
  binary release ships as a drop-in extension that can be planted into a
  user-owned PostgreSQL install without elevation. The
  [`install-timescaledb.ps1`](../scripts/install-timescaledb.ps1) script
  automates that drop-in.
* The dbt project deliberately uses standard SQL and no Timescale-only
  syntax inside the marts - `continuous` aggregates live next to the dbt
  models, not inside them - so the medallion layer ports to Snowflake /
  BigQuery / Redshift with a `dbt-postgres` → `dbt-snowflake` adapter swap.

### APScheduler in-process (not Airflow / Dagster / Prefect)

* The graph is tiny (6 ingestion jobs + 2 ML jobs, all on simple cron),
  the SLAs are loose (15 min for NOAA, hourly for EIA/ENTSO-E), and there's
  exactly one runtime host. Pulling in Airflow would add a database, a
  scheduler, an executor, and a web UI just to schedule eight cron rules.
* APScheduler runs inside the AsyncIO event loop alongside the httpx
  clients, so a slow fetch never blocks another source.
* The interface to APScheduler is one function (`build_scheduler()` in
  `gridintel.scheduler.service`), so swapping it for an Airflow DAG or a
  Dagster job is mechanical the day the cardinality grows past what
  in-process scheduling justifies.

### FastAPI between the frontend and the warehouse

* The React frontend (Cloudflare Pages) is a static SPA - it must reach the
  data over a network API rather than touching Postgres directly.
  FastAPI gives me one bounded, cacheable, **testable** data plane the
  frontend can hit and any other client (a Power BI custom connector,
  curl, a notebook) can use too.
* `/healthz` doubles as a kubelet-style liveness probe for whatever
  process manager ends up wrapping the service.

---

## Idempotency, late-arriving data, and the upsert pattern

Every ingestion job is structured as:

```python
upsert_rows(
    table="raw.demand",
    columns=["period_utc", "ba_code", "value_mwh", "series", "source"],
    conflict_cols=["period_utc", "ba_code", "series", "source"],
    rows=...,
)
```

That maps to `INSERT ... ON CONFLICT (...) DO UPDATE SET ...`. Two
implications:

1. **Replays are free.** Re-running `gridintel ingest eia --hours 6`
   re-fetches and re-writes the last 6 hours with no duplication and no
   error. This is what makes the backfill command safe to run from a clean
   warehouse: `gridintel backfill --hours 168` will paint the past week
   regardless of what's already there.
2. **Late-arriving facts are transparent.** EIA frequently revises the
   most recent few hours of `D` and `TI` as actuals come in from the BAs.
   Each scheduled run re-overwrites the prior hour, so the warehouse
   always reflects the latest published value without needing a separate
   "merge" pipeline.

In the dbt incremental models (`fct_demand_hourly`, `fct_generation_hourly`,
`fct_interchange_hourly`) the same property is enforced one layer up:

```sql
{% if is_incremental() %}
  where period_utc > (
    select coalesce(max(period_utc) - interval '36 hours', '1900-01-01'::timestamptz)
    from {{ this }}
  )
{% endif %}
```

Every incremental run re-processes the last 36 hours, so any late EIA
revisions propagate into the marts on the next dbt run. Combined with
`incremental_strategy='delete+insert'` and `unique_key`, this gives
straight-line idempotency end-to-end.

---

## Anomaly detection: why diurnal-normalised rolling-z

A naive 3σ rule on raw `demand_mwh` would flag every weekday morning peak
on every BA. The grid has three obvious confounds we have to remove
before the residual is anomalous:

1. **Diurnal shape.** PJM at 18:00 is structurally double PJM at 04:00.
2. **Weekly seasonality.** Saturday afternoons are systematically lighter
   than Tuesday afternoons.
3. **Long-term level drift.** Heat waves shift the baseline up for days
   at a time; we don't want every August day flagged as anomalous.

So the detector composes:

* a **7-day rolling-mean baseline** (handles slow level drift),
* a per-BA **hour-of-day diurnal multiplier** computed over the trailing
  14 days (handles the morning/evening peaks),
* a **168-hour rolling std** of the residual (handles weekly variance).

The expected value is `baseline.shift(1) × diurnal[h] / diurnal.mean()`;
the score is `(actual - expected) / rolling_std`. We re-score the last
24 hours on every scheduler tick (cron `15,45 * * * *`) so the most recent
hours get more accurate z-scores as their neighbours fill in.

That keeps the false-positive rate low enough to be useful: in 14 days of
demo data across 32 BAs, the dashboard surfaces ~10 anomalies in the
trailing 24h - almost all the ones the synthetic generator was explicitly
told to inject. With real EIA data the same detector picks up *Hurricane
Beryl 2024-07-08 in ERCOT*, the *Texas freeze 2021-02-15* and other
documented grid events when backfilled against bulk EIA history.

---

## Tests

| Where | What | How |
|---|---|---|
| `tests/test_config.py`    | env → settings → DSN composition | direct construction |
| `tests/test_eia_client.py`| EIA pagination & key validation  | `respx` HTTP mocks |
| `tests/test_noaa_client.py`| point resolution + forecast parsing | `respx` HTTP mocks |
| `tests/test_persist_eia.py` | period parsing + safe float + series classification | parametrized |
| `tests/test_demo_seed.py` | diurnal shape + weekday factor + region mix invariants | `hypothesis` property-based |
| `tests/test_api.py`        | every FastAPI route registered + OpenAPI shape | `TestClient` |
| `dbt test` | source freshness, unique/not-null on every fact PK, mart aggregates | dbt + dbt_utils |
| GitHub Actions | a full Postgres 17 service container, seed-demo, `dbt build`, ML jobs, pytest | `.github/workflows/ci.yml` |

The CI workflow is the canonical "does this run on a clean machine"
contract. It spins up Postgres 17, applies the schema, seeds 3 days of
demo data, runs `dbt build` (which executes the 34 dbt tests as part of
the DAG), runs the ML jobs against the seeded data, and finally runs
pytest - so a regression in any layer fails the build.
