{{ config(materialized='table') }}

with g as (
  select * from {{ ref('fct_generation_hourly') }}
  where period_utc > now() - (interval '1 hour' * {{ var('recent_hours', 72) }})
),
by_ba as (
  select ba_code, fuel_code, fuel_name, fuel_category, is_renewable, is_carbon_free,
         sum(generation_mwh) as mwh
  from g
  group by 1,2,3,4,5,6
),
ba_total as (
  select ba_code, sum(mwh) as total_mwh from by_ba group by 1
)
select
  b.ba_code,
  b.fuel_code,
  b.fuel_name,
  b.fuel_category,
  b.is_renewable,
  b.is_carbon_free,
  b.mwh,
  case when t.total_mwh > 0 then b.mwh / t.total_mwh * 100 else null end as share_pct
from by_ba b
join ba_total t on t.ba_code = b.ba_code
