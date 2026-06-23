{{ config(
    materialized='incremental',
    unique_key=['period_utc','ba_code'],
    incremental_strategy='delete+insert',
    on_schema_change='sync_all_columns'
) }}

with src as (
  select
    period_utc,
    ba_code,
    demand_mwh,
    forecast_mwh,
    forecast_error_mwh,
    case
      when forecast_mwh is null then null
      when forecast_mwh = 0 then null
      else abs(forecast_error_mwh) / abs(forecast_mwh) * 100
    end as abs_forecast_error_pct
  from {{ ref('int_demand_with_forecast') }}
  {% if is_incremental() %}
    -- Late-arriving fact: reload the last 36 hours every run.
    where period_utc > (select coalesce(max(period_utc) - interval '36 hours', '1900-01-01'::timestamptz) from {{ this }})
  {% endif %}
)
select * from src
