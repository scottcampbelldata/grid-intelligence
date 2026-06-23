-- ============================================================================
-- TimescaleDB compression + retention policies for grid-intelligence-platform.
-- Idempotent: re-runnable without error.
-- ============================================================================

-- Compress chunks older than 7 days, retain 730 days (2 years).
DO $$
DECLARE
    spec RECORD;
    tables_compress TEXT[][] := ARRAY[
        ['raw.demand',             'ba_code'],
        ['raw.demand_forecast',    'ba_code'],
        ['raw.generation',         'ba_code, fuel_code'],
        ['raw.interchange',        'from_ba, to_ba'],
        ['raw.entsoe_load',        'bidding_zone'],
        ['raw.entsoe_generation',  'bidding_zone, psr_type'],
        ['raw.weather',            'station_id'],
        ['raw.eu_weather',         'station_id'],
        ['ml.demand_forecast',     'ba_code, model_name'],
        ['ml.demand_anomaly',      'ba_code']
    ];
    tbl TEXT;
    seg TEXT;
BEGIN
    FOR i IN 1 .. array_length(tables_compress, 1) LOOP
        tbl := tables_compress[i][1];
        seg := tables_compress[i][2];
        BEGIN
            EXECUTE format(
                'ALTER TABLE %s SET (timescaledb.compress, timescaledb.compress_segmentby = %L, timescaledb.compress_orderby = %L);',
                tbl, seg, 'period_utc DESC'
            );
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'compress alter on % skipped: %', tbl, SQLERRM;
        END;
        BEGIN
            PERFORM add_compression_policy(tbl, INTERVAL '7 days', if_not_exists => TRUE);
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'compression policy on % skipped: %', tbl, SQLERRM;
        END;
        BEGIN
            PERFORM add_retention_policy(tbl, INTERVAL '730 days', if_not_exists => TRUE);
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'retention policy on % skipped: %', tbl, SQLERRM;
        END;
    END LOOP;
END
$$;

-- Continuous aggregates for hourly + daily demand rollups.
CREATE MATERIALIZED VIEW IF NOT EXISTS marts.demand_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', period_utc) AS bucket_utc,
    ba_code,
    avg(value_mwh) AS avg_mwh,
    max(value_mwh) AS peak_mwh,
    min(value_mwh) AS trough_mwh,
    count(*)       AS n_obs
FROM raw.demand
WHERE series = 'D'
GROUP BY 1, 2
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'marts.demand_hourly',
    start_offset => INTERVAL '7 days',
    end_offset   => INTERVAL '1 hour',
    schedule_interval => INTERVAL '15 minutes',
    if_not_exists => TRUE
);

CREATE MATERIALIZED VIEW IF NOT EXISTS marts.demand_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', period_utc) AS bucket_utc,
    ba_code,
    avg(value_mwh) AS avg_mwh,
    max(value_mwh) AS peak_mwh,
    min(value_mwh) AS trough_mwh,
    count(*)       AS n_obs
FROM raw.demand
WHERE series = 'D'
GROUP BY 1, 2
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'marts.demand_daily',
    start_offset => INTERVAL '180 days',
    end_offset   => INTERVAL '6 hours',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

CREATE MATERIALIZED VIEW IF NOT EXISTS marts.generation_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', period_utc) AS bucket_utc,
    ba_code,
    fuel_code,
    sum(value_mwh) AS total_mwh
FROM raw.generation
GROUP BY 1, 2, 3
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'marts.generation_hourly',
    start_offset => INTERVAL '7 days',
    end_offset   => INTERVAL '1 hour',
    schedule_interval => INTERVAL '15 minutes',
    if_not_exists => TRUE
);
