-- Blotato live account inventory on 2026-09-09 reports Adam Pierce YouTube as
-- account 45179. The registry and Dr. Adam Pierce persona still referenced the
-- retired 1182 id, leaving native collection and future publishing unresolved.

insert into public.blotato_accounts (account_id, platform, handle, brand, purpose)
values ('45179', 'youtube', 'Adam Pierce', 'Cybersecurity', 'Cyber')
on conflict (account_id) do update set
  platform = excluded.platform,
  handle = excluded.handle,
  brand = excluded.brand,
  purpose = excluded.purpose;

update public.personas
set platform_accounts = jsonb_set(platform_accounts, '{youtube}', '"45179"'::jsonb, true)
where name = 'Dr. Adam Pierce'
  and platform_accounts ->> 'youtube' = '1182';

delete from public.blotato_accounts
where account_id = '1182'
  and platform = 'youtube';
