-- Register the Facebook pages and the Faith & Harmony music channel so every
-- analytics-pull row lands under its own account (job 2026-10-26-devops-metrics-attribution).
--
-- Blotato account 3684 is one Facebook connection carrying several pages, so the
-- page id decides the handle: account_id = '<account>/<page id>'. analytics-pull
-- resolves the page-level key first, then the bare account id (the bare '3684'
-- row stays for persona-matched pieces). Additive only; no existing row changes.
insert into public.blotato_accounts (account_id, platform, handle, brand, purpose) values
  ('3684/1063375450183829', 'facebook', 'The North East Corner (facebook)', 'North East Corner', 'Masonic education'),
  ('3684/899526466587385',  'facebook', 'Sentinel Aerial Inspections (facebook)', 'Sentinel Aerial', 'Part 107 training'),
  ('54659',                 'youtube',  'Faith & Harmony (Neo-Soul)', 'Faith & Harmony', 'Neo-soul instrumentals')
on conflict (account_id) do nothing;
