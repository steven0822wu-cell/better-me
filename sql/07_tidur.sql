-- =========================================================
-- BETTER ME — Absen Tidur & Bangun (di halaman Habit)
-- Jalankan SEKALI di Supabase SQL Editor (aman dijalankan ulang).
-- =========================================================

-- 1 baris = 1 malam. "malam" = tanggal malam itu dimulai
-- (tidur jam 00:40 tgl 17 → malam tgl 16).
create table if not exists sleep_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references profiles(id) on delete cascade,
  malam       date not null,
  tidur_at    timestamptz not null,
  bangun_at   timestamptz,
  kualitas    smallint check (kualitas between 1 and 5),
  catatan     text,
  created_at  timestamptz not null default now(),
  unique (user_id, malam),
  check (bangun_at is null or bangun_at > tidur_at),
  check (bangun_at is null or bangun_at - tidur_at < interval '20 hours')
);
create index if not exists idx_sleep_user_malam on sleep_logs (user_id, malam desc);

-- Target jam tidur/bangun + habit yang otomatis dicentang kalau tepat waktu
create table if not exists sleep_settings (
  user_id       uuid primary key default auth.uid() references profiles(id) on delete cascade,
  target_tidur  time not null default '23:00',
  target_bangun time not null default '06:00',
  target_jam    numeric(3,1) not null default 7.5,
  habit_tidur   uuid references habits(id) on delete set null,
  habit_bangun  uuid references habits(id) on delete set null,
  updated_at    timestamptz not null default now()
);

-- RLS: semua member boleh lihat (mode pantau), hanya pemilik yang boleh ubah
do $$
declare t text;
begin
  foreach t in array array['sleep_logs', 'sleep_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists p_select on %I', t);
    execute format('drop policy if exists p_insert on %I', t);
    execute format('drop policy if exists p_update on %I', t);
    execute format('drop policy if exists p_delete on %I', t);
    execute format('create policy p_select on %I for select to authenticated using (true)', t);
    execute format('create policy p_insert on %I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy p_update on %I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy p_delete on %I for delete to authenticated using (user_id = auth.uid())', t);
  end loop;
end $$;

-- Habit yang dihubungkan harus milik sendiri
drop trigger if exists trg_owner_sleep_ht on sleep_settings;
create trigger trg_owner_sleep_ht before insert or update on sleep_settings
  for each row execute function enforce_same_owner('habits', 'habit_tidur');
drop trigger if exists trg_owner_sleep_hb on sleep_settings;
create trigger trg_owner_sleep_hb before insert or update on sleep_settings
  for each row execute function enforce_same_owner('habits', 'habit_bangun');
