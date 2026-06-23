{{ config(materialized='view') }}

select
  period_utc,
  ba_code,
  fuel_code,
  value_mwh as generation_mwh
from {{ source('raw', 'generation') }}
