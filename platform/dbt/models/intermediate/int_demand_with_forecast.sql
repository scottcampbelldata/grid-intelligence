{{ config(materialized='view') }}

with d as (
  select * from {{ ref('stg_demand') }}
),
f as (
  select * from {{ ref('stg_demand_forecast') }}
)
select
  d.period_utc,
  d.ba_code,
  d.demand_mwh,
  f.forecast_mwh,
  d.demand_mwh - coalesce(f.forecast_mwh, d.demand_mwh) as forecast_error_mwh
from d
left join f
  on f.period_utc = d.period_utc
 and f.ba_code   = d.ba_code
