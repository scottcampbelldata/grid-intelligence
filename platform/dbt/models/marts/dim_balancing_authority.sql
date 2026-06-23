{{ config(materialized='table') }}

with seeded as (
  select * from {{ ref('balancing_authority_meta') }}
),
seen as (
  select distinct ba_code
  from {{ source('raw', 'demand') }}
  where period_utc > now() - interval '90 days'
)
select
  s.ba_code,
  coalesce(b.ba_name, s.ba_code)                  as ba_name,
  coalesce(b.region,   'Unknown')                 as region,
  coalesce(b.country,  'US')                      as country,
  coalesce(b.timezone, 'UTC')                     as timezone,
  {{ dbt_utils.generate_surrogate_key(['s.ba_code']) }} as ba_sk
from seen s
left join seeded b on b.ba_code = s.ba_code
