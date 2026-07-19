-- Per-persona opt-in for Facebook auto-posting.
--
-- Facebook publishing (FB Reels via the persona's Page) is now wired into
-- daily-publish, but several personas already carry FB page config that has
-- never been cleared to auto-post (the Masonic NE Corner / Brighton Rock pages).
-- Gate FB behind an explicit per-persona flag so enabling the capability does
-- not silently start posting to those live pages — only opted-in personas
-- (starting with Sentinel Aerial) publish to Facebook.
alter table public.personas
  add column if not exists facebook_enabled boolean not null default false;
