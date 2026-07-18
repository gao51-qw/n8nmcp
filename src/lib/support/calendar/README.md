# China Support Calendar

SLA uses normal Monday-Friday workdays unless `support_calendar_days` overrides
a date.

## Loaded calendar

The 2026 overrides are loaded by
`supabase/migrations/20260611223000_seed_2026_support_calendar.sql`.
They come from State Council General Office notice [2025] No. 7:

<https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm>

The migration contains only dates that change the default calendar:

- Weekday closures are stored as `holiday`.
- Official Saturday or Sunday make-up workdays are stored as
  `makeup_workday`.
- Weekend dates that remain non-working are not stored because they do not
  override the default.

## Annual update

Before enabling support for a new calendar year:

1. Obtain the State Council General Office holiday notice from
   <https://www.gov.cn/zhengce/>.
2. Have two maintainers review every weekday closure and weekend make-up
   workday against the notice.
3. Add a new year-specific seed migration. Do not edit a migration that has
   already been deployed.
4. Use an idempotent upsert and include the exact official source URL in the
   migration comment.
5. Run `supabase db reset` and `supabase test db`.
6. Run the verification queries below and archive the source URL and review
   result in the deployment record.

Use the 2026 seed migration as the SQL shape, replacing its `values` list only
after the new notice has been reviewed. Do not put example or predicted dates
in a production migration.

Verification:

```sql
select day, kind, name
from public.support_calendar_days
where day between date '2026-01-01' and date '2026-12-31'
order by day;

select kind, count(*)
from public.support_calendar_days
where day between date '2026-01-01' and date '2026-12-31'
group by kind
order by kind;
```

For 2026, verification returns 19 `holiday` rows and 6 `makeup_workday`
rows. Never infer future dates from previous years. If the government issues a
correction, add a later corrective migration and preserve the original
migration history.
