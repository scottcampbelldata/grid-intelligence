{{ config(materialized='view') }}

select
  period_utc,
  from_ba,
  to_ba,
  value_mwh as net_mwh
from {{ source('raw', 'interchange') }}
