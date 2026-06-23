{{ config(materialized='view') }}

with src as (
  select
    period_utc,
    ba_code,
    value_mwh,
    series,
    source
  from {{ source('raw', 'demand') }}
)
select
  period_utc,
  ba_code,
  value_mwh as demand_mwh,
  source
from src
where series = 'D'
