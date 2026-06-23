# Power BI report

Two consumers of one well-modeled warehouse:

* **Live ops view** → the [React frontend + FastAPI dashboard](https://grid.scottcampbell.io),
  auto-refreshing every 60 s.
* **Executive deck** → this Power BI report, served from the same dbt marts via
  flat CSV extracts (no live warehouse needed at present time - a hiring
  manager can open the .pbix straight from a fresh clone).

The .pbix is a connect-and-drop exercise on top of the warehouse - all
business logic lives in dbt + the DAX measures shipped here, never in
Power Query.

---

## 1. Connect to the data

Two equivalent paths - pick whichever fits the audience.

### A. From the CSV extracts (self-contained, recommended for portfolio review)

Point Power BI Desktop at the extracts produced by `scripts/export-marts.py`:

```
data/processed/marts/
├── mart_demand_hourly.csv          (~12k rows / 14 days × ~70 BAs)
├── mart_generation_hourly.csv      (~30k rows / 7 days × BAs × fuels)
├── mart_renewable_share_hourly.csv (network-wide hourly mix %)
├── mart_anomalies.csv              (last 7 days of demand anomaly scores)
├── mart_forecast.csv               (next-24h SARIMAX forecasts per BA)
├── mart_interchange.csv            (inter-BA hourly flows)
├── mart_source_freshness.csv       (ingestion lag per source)
├── mart_ingest_runs.csv            (last 200 scheduled job runs)
├── dim_balancing_authority.csv     (BA name / region / country / tz)
└── dim_fuel_type.csv               (fuel code / renewable + carbon-free flags)
```

**Get Data → Folder** pointing at `data/processed/marts`, then promote each
file. Refresh by running `python scripts/export-marts.py`.

### B. Direct from the warehouse (live)

**Get Data → PostgreSQL database**, server `localhost:5432`, database
`grid_intel`, credentials from `.env` (`grid_app` / `PGPASSWORD`). Pull the
same query results from `gridintel/api/main.py` - the SQL is identical, just
parametrized.

Use this path when the report is going to be hosted on Power BI Service with
a scheduled refresh - then the dataset stays current as the streaming
pipeline runs.

---

## 2. Model

* Mark `mart_demand_hourly[period_utc]` as the date column (or build a
  dedicated `Date` table covering ~30 days back ↔ 7 days forward).
* Active relationships (single-direction, many-to-one):
  * `mart_demand_hourly[ba_code]`            → `dim_balancing_authority[ba_code]`
  * `mart_generation_hourly[ba_code]`        → `dim_balancing_authority[ba_code]`
  * `mart_generation_hourly[fuel_code]`      → `dim_fuel_type[fuel_code]`
  * `mart_anomalies[ba_code]`                → `dim_balancing_authority[ba_code]`
  * `mart_forecast[ba_code]`                 → `dim_balancing_authority[ba_code]`
  * `mart_interchange[from_ba]`              → `dim_balancing_authority[ba_code]`
* Disable auto date/time hierarchies - `period_utc` is already at hour grain.

Apply the theme: **View → Themes → Browse for themes →** `powerbi/theme.json`.

---

## 3. Measures

Import `measures.dax` into a `_Measures` table (Modeling → New table →
`_Measures = ROW("dummy", BLANK())`, then paste each measure as New measure).
Or, faster: in **External Tools → Tabular Editor**, paste the file into a
"Calculation Group" import. Highlights:

* `Demand (MWh, period)` - sum of realised demand over the slicer range
* `Forecast Accuracy %` - `1 − avg(abs_forecast_error_pct)`
* `Renewable Share %`, `Carbon-Free Share %` - mix breakdown
* `Critical Anomalies`, `Anomaly Rate %` - flagged hour counts
* `Freshness Lag (min)` - minutes since the last successful EIA pull
* `BA with Highest Demand`, `Top Fuel by MWh` - Card-friendly text measures

---

## 4. Suggested report pages

Each page reproduces a section of the React dashboard so the two views
tell the same story.

1. **Executive Summary**
   * KPI cards: *Demand (last hour)*, *Renewable Share %*, *Carbon-Free %*,
     *Critical Anomalies (24h)*, *Forecast Accuracy %*
   * Line chart: network-wide hourly demand, last 72 h
   * Map (filled / bubble): demand by BA centroid, colored by region
2. **Demand & Forecast**
   * Slicer: BA dropdown
   * Line chart: actual vs forecast vs 80% confidence band
   * Card: forecast MAPE per BA
   * Bar: top-15 BAs by total energy in the slicer window
3. **Generation Mix**
   * Donut: per-fuel share network-wide (last 24h)
   * Stacked area: hourly mix by fuel over the last 7 days
   * Decomposition tree: total MWh broken by region → BA → fuel
4. **AI Early Warning**
   * Card: critical anomaly count + flagged severity histogram
   * Table: most-recent flagged hours (period · BA · actual · expected · z)
   * Drill-through to the BA-detail page
5. **Pipeline Health**
   * KPI tiles: rows in last 24h per source; max freshness lag minutes
   * Table: `mart_ingest_runs` filtered to last 24 h, colored by status
   * Notes panel: how each source's cron is scheduled

The dashboard screenshots in `docs/images/` show the exact visuals to mirror.

---

## 5. Deliverable

Drop the exported `grid-intel.pbix` next to this README and commit. Screenshot
each page into `docs/images/powerbi/`. Update the main project README's
dashboard section to link to the .pbix alongside the live frontend URL.
