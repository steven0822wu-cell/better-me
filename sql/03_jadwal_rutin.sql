-- =========================================================
-- BETTER ME — Jadwal Rutin (bagian dari halaman To-do)
-- Jalankan SEKALI di Supabase SQL Editor.
-- Aman dijalankan ulang (tidak menghapus data).
-- =========================================================

-- Jadwal mingguan yang tetap (contoh: Mengajar Sen & Rab 16:00–18:00)
create table if not exists schedules (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references profiles(id) on delete cascade,
  judul           text not null,
  hari            smallint[] not null check (array_length(hari, 1) > 0 and hari <@ array[1,2,3,4,5,6,7]::smallint[]),
                  -- 1 = Senin ... 7 = Minggu
  jam_mulai       time not null,
  jam_selesai     time,
  lokasi          text,
  icon            text not null default '📌',
  warna           text not null default '#7c9cff',
  berlaku_mulai   date not null default current_date,
  berlaku_sampai  date,
  aktif           boolean not null default true,
  created_at      timestamptz not null default now(),
  check (jam_selesai is null or jam_selesai > jam_mulai),
  check (berlaku_sampai is null or berlaku_sampai >= berlaku_mulai)
);

-- Centang "sudah dijalani" per tanggal
create table if not exists schedule_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references profiles(id) on delete cascade,
  schedule_id  uuid not null references schedules(id) on delete cascade,
  tanggal      date not null,
  done         boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (schedule_id, tanggal)
);

create index if not exists idx_schedules_user      on schedules (user_id);
create index if not exists idx_schedule_logs_user  on schedule_logs (user_id, tanggal);

-- RLS: semua member boleh baca (mode pantau), hanya pemilik yang boleh tulis
do $$
declare t text;
begin
  foreach t in array array['schedules','schedule_logs'] loop
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

-- Log harus milik user yang sama dengan jadwalnya
drop trigger if exists trg_owner_schedule_logs on schedule_logs;
create trigger trg_owner_schedule_logs before insert or update on schedule_logs
  for each row execute function enforce_same_owner('schedules','schedule_id');
