{{ config(
    materialized='incremental',
    unique_key=['period_utc','ba_code','fuel_code'],
    incremental_strategy='delete+insert',
    on_schema_change='sync_all_columns'
) }}

with src as (
  select
    period_utc,
    ba_code,
    fuel_code,
    fuel_name,
    fuel_category,
    is_renewable,
    is_carbon_free,
    generation_mwh
  from {{ ref('int_generation_with_meta') }}
  {% if is_incremental() %}
    where period_utc > (select coalesce(max(period_utc) - interval '36 hours', '1900-01-01'::timestamptz) from {{ this }})
  {% endif %}
)
select * from src
