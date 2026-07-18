-- Source: State Council General Office notice [2025] No. 7.
-- https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm
--
-- The default calendar already treats Monday-Friday as working days and
-- Saturday-Sunday as non-working days. Seed only dates that override that
-- default: weekday holidays and weekend make-up workdays.
insert into public.support_calendar_days (day, kind, name)
values
  ('2026-01-01', 'holiday', 'New Year holiday'),
  ('2026-01-02', 'holiday', 'New Year holiday'),
  ('2026-01-04', 'makeup_workday', 'New Year make-up workday'),

  ('2026-02-14', 'makeup_workday', 'Spring Festival make-up workday'),
  ('2026-02-16', 'holiday', 'Spring Festival holiday'),
  ('2026-02-17', 'holiday', 'Spring Festival holiday'),
  ('2026-02-18', 'holiday', 'Spring Festival holiday'),
  ('2026-02-19', 'holiday', 'Spring Festival holiday'),
  ('2026-02-20', 'holiday', 'Spring Festival holiday'),
  ('2026-02-23', 'holiday', 'Spring Festival holiday'),
  ('2026-02-28', 'makeup_workday', 'Spring Festival make-up workday'),

  ('2026-04-06', 'holiday', 'Qingming Festival holiday'),

  ('2026-05-01', 'holiday', 'Labour Day holiday'),
  ('2026-05-04', 'holiday', 'Labour Day holiday'),
  ('2026-05-05', 'holiday', 'Labour Day holiday'),
  ('2026-05-09', 'makeup_workday', 'Labour Day make-up workday'),

  ('2026-06-19', 'holiday', 'Dragon Boat Festival holiday'),

  ('2026-09-20', 'makeup_workday', 'National Day make-up workday'),
  ('2026-09-25', 'holiday', 'Mid-Autumn Festival holiday'),

  ('2026-10-01', 'holiday', 'National Day holiday'),
  ('2026-10-02', 'holiday', 'National Day holiday'),
  ('2026-10-05', 'holiday', 'National Day holiday'),
  ('2026-10-06', 'holiday', 'National Day holiday'),
  ('2026-10-07', 'holiday', 'National Day holiday'),
  ('2026-10-10', 'makeup_workday', 'National Day make-up workday')
on conflict (day) do update
set kind = excluded.kind,
    name = excluded.name;
