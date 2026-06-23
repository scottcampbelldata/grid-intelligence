{{ config(materialized='table') }}

with g as (
  select * from {{ ref('fct_generation_hourly') }}
  where period_utc > now() - (interval '1 hour' * {{ var('recent_hours', 72) }})
),
hourly as (
  select
    period_utc,
    sum(case when is_renewable    then generation_mwh else 0 end) as renewable_mwh,
    sum(case when is_carbon_free  then generation_mwh else 0 end) as carbon_free_mwh,
    sum(generation_mwh)                                           as total_mwh
  from g
  group by 1
)
select
  period_utc,
  renewable_mwh,
  carbon_free_mwh,
  total_mwh,
  case when total_mwh > 0 then renewable_mwh   / total_mwh * 100 else null end as renewable_pct,
  case when total_mwh > 0 then carbon_free_mwh / total_mwh * 100 else null end as carbon_free_pct
from hourly
