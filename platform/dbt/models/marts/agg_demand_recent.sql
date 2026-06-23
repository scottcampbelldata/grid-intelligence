{{ config(materialized='table') }}

with d as (
  select * from {{ ref('fct_demand_hourly') }}
  where period_utc > now() - (interval '1 hour' * {{ var('recent_hours', 72) }})
)
select
  ba_code,
  count(*)                                                       as n_obs,
  min(period_utc)                                                as first_period_utc,
  max(period_utc)                                                as last_period_utc,
  avg(demand_mwh)                                                as avg_mwh,
  max(demand_mwh)                                                as peak_mwh,
  min(demand_mwh)                                                as trough_mwh,
  avg(abs_forecast_error_pct)                                    as avg_abs_error_pct,
  percentile_cont(0.95) within group (order by demand_mwh)       as p95_mwh
from d
group by 1
