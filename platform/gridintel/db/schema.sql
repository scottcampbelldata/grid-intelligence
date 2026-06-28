-- ============================================================================
-- Grid Intelligence Platform - base schema (TimescaleDB-aware, graceful fallback)
-- Idempotent: re-runnable on a fresh or partially populated database.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS marts;
CREATE SCHEMA IF NOT EXISTS ml;
CREATE SCHEMA IF NOT EXISTS ops;

-- Try TimescaleDB; tolerate its absence (the raw tables still work as plain
-- partitioned-by-time tables, just without continuous aggregates).
DO $$
BEGIN
    BEGIN
        CREATE EXTENSION IF NOT EXISTS timescaledb;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TimescaleDB extension not available; continuing on plain Postgres.';
    END;
END
$$;

-- ---------------------------------------------------------------------------
-- Reference / dimension data
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.balancing_authority (
    ba_code        TEXT PRIMARY KEY,
    ba_name        TEXT NOT NULL,
    region         TEXT,
    country        TEXT NOT NULL DEFAULT 'US',
    timezone       TEXT,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    inserted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS raw.fuel_type (
    fuel_code      TEXT PRIMARY KEY,
    fuel_name      TEXT NOT NULL,
    is_renewable   BOOLEAN NOT NULL DEFAULT FALSE,
    is_carbon_free BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO raw.fuel_type (fuel_code, fuel_name, is_renewable, is_carbon_free) VALUES
    ('COL', 'Coal',          FALSE, FALSE),
    ('NG',  'Natural Gas',   FALSE, FALSE),
    ('NUC', 'Nuclear',       FALSE, TRUE),
    ('OIL', 'Petroleum',     FALSE, FALSE),
    ('WAT', 'Hydro',         TRUE,  TRUE),
    ('WND', 'Wind',          TRUE,  TRUE),
    ('SUN', 'Solar',         TRUE,  TRUE),
    ('GEO', 'Geothermal',    TRUE,  TRUE),
    ('BIO', 'Biomass',       TRUE,  FALSE),
    ('OTH', 'Other',         FALSE, FALSE)
ON CONFLICT (fuel_code) DO UPDATE
    SET fuel_name = EXCLUDED.fuel_name,
        is_renewable = EXCLUDED.is_renewable,
        is_carbon_free = EXCLUDED.is_carbon_free;

CREATE TABLE IF NOT EXISTS raw.weather_station (
    station_id     TEXT PRIMARY KEY,
    name           TEXT,
    latitude       DOUBLE PRECISION,
    longitude      DOUBLE PRECISION,
    ba_code        TEXT REFERENCES raw.balancing_authority(ba_code),
    grid_id        TEXT,
    grid_x         INTEGER,
    grid_y         INTEGER,
    inserted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Fact-style time-series tables (hypertables where Timescale is loaded)
-- ---------------------------------------------------------------------------

-- EIA hourly demand by balancing authority
CREATE TABLE IF NOT EXISTS raw.demand (
    period_utc     TIMESTAMPTZ NOT NULL,
    ba_code        TEXT NOT NULL,
    value_mwh      DOUBLE PRECISION,
    series         TEXT NOT NULL DEFAULT 'D',   -- D=demand, NG=net gen, TI=interchange
    source         TEXT NOT NULL DEFAULT 'EIA',
    inserted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (period_utc, ba_code, series, source)
);

-- Demand forecast by EIA (DF)
CREATE TABLE IF NOT EXISTS raw.demand_forecast (
    period_utc     TIMESTAMPTZ NOT NULL,
    ba_code        TEXT NOT NULL,
    value_mwh      DOUBLE PRECISION,
    source         TEXT NOT NULL DEFAULT 'EIA',
    inserted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (period_utc, ba_code, source)
);

-- Generation by fuel type by BA
CREATE TABLE IF NOT EXISTS raw.generation (
    period_utc     TIMESTAMPTZ NOT NULL,
    ba_code        TEXT NOT NULL,
    fuel_code      TEXT NOT NULL,
    value_mwh      DOUBLE PRECISION,
    source         TEXT NOT NULL DEFAULT 'EIA',
    inserted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (period_utc, ba_code, fuel_code, source)
);

-- Interchange between BAs
CREATE TABLE IF NOT EXISTS raw.interchange (
    period_utc     TIMESTAMPTZ NOT NULL,
    from_ba        TEXT NOT NULL,
    to_ba          TEXT NOT NULL,
    value_mwh      DOUBLE PRECISION,
    source         TEXT NOT NULL DEFAULT 'EIA',
    inserted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (period_utc, from_ba, to_ba, source)
);

-- ENTSO-E European load (per bidding zone / country)
CREATE TABLE IF NOT EXISTS raw.entsoe_load (
    period_utc     TIMESTAMPTZ NOT NULL,
    bidding_zone   TEXT NOT NULL,
    value_mw       DOUBLE PRECISION,
    process_type   TEXT NOT NULL DEFAULT 'A16',  -- A16 = Realised
    source         TEXT NOT NULL DEFAULT 'ENTSOE',
    inserted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (period_utc, bidding_zone, process_type, source)
);

CREATE TABLE IF NOT EXISTS raw.entsoe_generation (
    period_utc     TIMESTAMPTZ NOT NULL,
    bidding_zone   TEXT NOT NULL,
    psr_type       TEXT NOT NULL,  -- production type code (B01..B20)
    value_mw       DOUBLE PRECISION,
    source         TEXT NOT NULL DEFAULT 'ENTSOE',
    inserted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (period_utc, bidding_zone, psr_type, source)
);

-- NOAA weather observations
CREATE TABLE IF NOT EXISTS raw.weather (
    period_utc       TIMESTAMPTZ NOT NULL,
    station_id       TEXT NOT NULL,
    temperature_c    DOUBLE PRECISION,
    wind_speed_kph   DOUBLE PRECISION,
    cloud_cover_pct  DOUBLE PRECISION,
    short_forecast   TEXT,
    inserted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (period_utc, station_id)
);

-- European bidding-zone centroids (reference; parallel to raw.weather_station).
-- One representative point per ENTSO-E zone, used to call the Open-Meteo API
-- and to attach lat/lon to ``raw.eu_weather`` for the Europe weather map.
CREATE TABLE IF NOT EXISTS raw.eu_weather_zone (
    zone_eic       TEXT PRIMARY KEY,
    zone_name      TEXT,
    latitude       DOUBLE PRECISION,
    longitude      DOUBLE PRECISION,
    inserted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Open-Meteo European weather (parallel to raw.weather; station_id = 'EU:<eic>')
CREATE TABLE IF NOT EXISTS raw.eu_weather (
    period_utc       TIMESTAMPTZ NOT NULL,
    station_id       TEXT NOT NULL,
    temperature_c    DOUBLE PRECISION,
    wind_speed_kph   DOUBLE PRECISION,
    cloud_cover_pct  DOUBLE PRECISION,
    short_forecast   TEXT,
    inserted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (period_utc, station_id)
);

-- Operational / observability tables
CREATE TABLE IF NOT EXISTS ops.ingest_run (
    run_id          BIGSERIAL PRIMARY KEY,
    source          TEXT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    rows_written    BIGINT NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'running',  -- running | ok | error
    error_message   TEXT,
    payload         JSONB
);

CREATE INDEX IF NOT EXISTS ix_ingest_run_source_started
    ON ops.ingest_run (source, started_at DESC);

CREATE TABLE IF NOT EXISTS ops.source_freshness (
    source           TEXT PRIMARY KEY,
    last_period_utc  TIMESTAMPTZ,
    last_fetch_utc   TIMESTAMPTZ,
    last_rows        BIGINT,
    last_error       TEXT
);

-- ---------------------------------------------------------------------------
-- ML output tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ml.demand_forecast (
    period_utc     TIMESTAMPTZ NOT NULL,
    ba_code        TEXT NOT NULL,
    yhat_mwh       DOUBLE PRECISION,
    yhat_lower     DOUBLE PRECISION,
    yhat_upper     DOUBLE PRECISION,
    model_name     TEXT NOT NULL,
    fit_at_utc     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- fit_at_utc is part of the key: every run stores a distinct forecast
    -- vintage (the API/accuracy endpoints pick recent vintages by fit_at_utc).
    -- The upsert conflict target in ml/jobs.py must match this exactly.
    PRIMARY KEY (period_utc, ba_code, model_name, fit_at_utc)
);

CREATE TABLE IF NOT EXISTS ml.demand_anomaly (
    period_utc     TIMESTAMPTZ NOT NULL,
    ba_code        TEXT NOT NULL,
    actual_mwh     DOUBLE PRECISION,
    expected_mwh   DOUBLE PRECISION,
    residual_mwh   DOUBLE PRECISION,
    z_score        DOUBLE PRECISION,
    is_anomaly     BOOLEAN NOT NULL DEFAULT FALSE,
    severity       TEXT,  -- info | warn | critical
    detected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (period_utc, ba_code)
);

CREATE TABLE IF NOT EXISTS ml.generation_mix_shift (
    detected_at_utc  TIMESTAMPTZ NOT NULL,
    ba_code          TEXT NOT NULL,
    fuel_code        TEXT NOT NULL,
    share_now        DOUBLE PRECISION,
    share_baseline   DOUBLE PRECISION,
    shift_pp         DOUBLE PRECISION,    -- percentage points
    severity         TEXT,
    PRIMARY KEY (detected_at_utc, ba_code, fuel_code)
);

-- ---------------------------------------------------------------------------
-- Promote to Timescale hypertables when extension is present.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    has_ts BOOLEAN;
    tbl    TEXT;
    tables TEXT[] := ARRAY[
        'raw.demand',
        'raw.demand_forecast',
        'raw.generation',
        'raw.interchange',
        'raw.entsoe_load',
        'raw.entsoe_generation',
        'raw.weather',
        'raw.eu_weather',
        'ml.demand_forecast',
        'ml.demand_anomaly'
    ];
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'
    ) INTO has_ts;

    IF has_ts THEN
        FOREACH tbl IN ARRAY tables LOOP
            EXECUTE format(
                'SELECT create_hypertable(%L, by_range(''period_utc''), if_not_exists => TRUE);',
                tbl
            );
        END LOOP;
    END IF;
END
$$;

-- Indexes that help interactive queries regardless of hypertable status
CREATE INDEX IF NOT EXISTS ix_demand_ba_period ON raw.demand (ba_code, period_utc DESC);
CREATE INDEX IF NOT EXISTS ix_generation_ba_fuel_period
    ON raw.generation (ba_code, fuel_code, period_utc DESC);
CREATE INDEX IF NOT EXISTS ix_interchange_from_period
    ON raw.interchange (from_ba, period_utc DESC);
CREATE INDEX IF NOT EXISTS ix_weather_station_period
    ON raw.weather (station_id, period_utc DESC);
CREATE INDEX IF NOT EXISTS ix_eu_weather_station_period
    ON raw.eu_weather (station_id, period_utc DESC);
CREATE INDEX IF NOT EXISTS ix_ml_anomaly_ba_period
    ON ml.demand_anomaly (ba_code, period_utc DESC) WHERE is_anomaly;
