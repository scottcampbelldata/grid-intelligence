{{ config(materialized='view') }}

with g as (
  select * from {{ ref('stg_generation') }}
),
m as (
  select fuel_code, fuel_name, category, is_renewable, is_carbon_free
  from {{ ref('fuel_type_meta') }}
)
select
  g.period_utc,
  g.ba_code,
  g.fuel_code,
  coalesce(m.fuel_name, g.fuel_code)   as fuel_name,
  coalesce(m.category, 'Other')        as fuel_category,
  coalesce(m.is_renewable, false)      as is_renewable,
  coalesce(m.is_carbon_free, false)    as is_carbon_free,
  g.generation_mwh
from g
left join m on g.fuel_code = m.fuel_code
