-- =========================================================
-- BETTER ME — Notifikasi HP (Web Push)
-- LANGKAH 1 dari panduan: jalankan SQL ini dulu, lalu buat Edge Function "notif".
-- Aman dijalankan ulang.
-- =========================================================

-- Perangkat yang berlangganan notifikasi (1 user bisa punya beberapa HP/laptop)
create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

-- Pengaturan pengingat per user
create table if not exists notif_settings (
  user_id      uuid primary key default auth.uid() references profiles(id) on delete cascade,
  enabled      boolean not null default true,
  tz           text not null default 'Asia/Jakarta',
  quiet_start  time not null default '23:00',
  quiet_end    time not null default '06:00',
  prefs        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

-- Catatan notifikasi yang sudah terkirim (supaya tidak dobel)
create table if not exists notif_log (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references profiles(id) on delete cascade,
  key      text not null,
  title    text,
  body     text,
  sent_at  timestamptz not null default now(),
  unique (user_id, key)
);
create index if not exists idx_notif_log_user_time on notif_log (user_id, sent_at desc);

-- Konfigurasi internal (kunci VAPID & kunci cron) — tidak bisa dibaca dari app
create table if not exists push_config (
  key    text primary key,
  value  text not null
);
insert into push_config (key, value)
values ('cron_key', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- Jam pengingat per habit
alter table habits add column if not exists jam_pengingat time;

-- ---------- RLS ----------
alter table push_subscriptions enable row level security;
alter table notif_settings     enable row level security;
alter table notif_log          enable row level security;
alter table push_config        enable row level security;   -- tanpa policy = hanya server

drop policy if exists p_sub_select on push_subscriptions;
drop policy if exists p_sub_insert on push_subscriptions;
drop policy if exists p_sub_update on push_subscriptions;
drop policy if exists p_sub_delete on push_subscriptions;
create policy p_sub_select on push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy p_sub_insert on push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy p_sub_update on push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy p_sub_delete on push_subscriptions for delete to authenticated using (user_id = auth.uid());

drop policy if exists p_ns_select on notif_settings;
drop policy if exists p_ns_insert on notif_settings;
drop policy if exists p_ns_update on notif_settings;
create policy p_ns_select on notif_settings for select to authenticated using (user_id = auth.uid());
create policy p_ns_insert on notif_settings for insert to authenticated with check (user_id = auth.uid());
create policy p_ns_update on notif_settings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists p_nl_select on notif_log;
create policy p_nl_select on notif_log for select to authenticated using (user_id = auth.uid());

-- Kalau HP yang sama dipakai bergantian login, endpoint pindah ke user baru
create or replace function claim_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_ua)
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end $$;
revoke all on function claim_push_subscription(text, text, text, text) from public, anon;
grant execute on function claim_push_subscription(text, text, text, text) to authenticated;

-- Bersihkan log lama (> 120 hari) supaya tabel tetap kecil
create or replace function prune_notif_log() returns void language sql security definer set search_path = public as $$
  delete from notif_log where sent_at < now() - interval '120 days';
$$;
revoke all on function prune_notif_log() from public, anon, authenticated;

-- ---------- Penjadwal: panggil Edge Function tiap 5 menit ----------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname in ('better-me-notif', 'better-me-notif-prune');

select cron.schedule(
  'better-me-notif',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://nbklarsszktgchbcjflp.supabase.co/functions/v1/notif',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-key', (select value from public.push_config where key = 'cron_key')),
    body    := '{"action":"run"}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

select cron.schedule('better-me-notif-prune', '17 3 * * *', $$ select public.prune_notif_log(); $$);

-- Cek: harus muncul 2 baris job
select jobname, schedule, active from cron.job where jobname like 'better-me-notif%';
