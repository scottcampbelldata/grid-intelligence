{{ config(materialized='view') }}

select
  period_utc,
  ba_code,
  value_mwh as forecast_mwh,
  source
from {{ source('raw', 'demand_forecast') }}
