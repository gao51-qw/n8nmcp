select proname
from pg_proc
join pg_namespace namespace on namespace.oid = pronamespace
where namespace.nspname = 'public'
  and proname in (
    'support_scan_sla',
    'support_claim_expired_attachments',
    'claim_support_notifications'
  )
order by proname;
