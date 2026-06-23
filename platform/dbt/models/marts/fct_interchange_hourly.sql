{{ config(
    materialized='incremental',
    unique_key=['period_utc','from_ba','to_ba'],
    incremental_strategy='delete+insert'
) }}

select
  period_utc,
  from_ba,
  to_ba,
  net_mwh
from {{ ref('stg_interchange') }}
{% if is_incremental() %}
  where period_utc > (select coalesce(max(period_utc) - interval '36 hours', '1900-01-01'::timestamptz) from {{ this }})
{% endif %}
