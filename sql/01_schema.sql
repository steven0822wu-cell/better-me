-- =========================================================
-- BETTER ME PROJECT — Schema + RLS (Fase 1)
-- Jalankan di Supabase SQL Editor, sekali jalan.
-- Prinsip: data tiap user TERPISAH (user_id),
--          semua member boleh BACA (mode pantau),
--          hanya pemilik yang boleh TULIS.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------- PROFILES ----------
create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null unique check (display_name in ('Steve','Pelaa')),
  theme         text not null default 'midnight'
                check (theme in ('hero','oldmoney','supercar','zen','cyber','midnight','forest')),
  currency_view text not null default 'IDR' check (currency_view in ('IDR','USD')),
  created_at    timestamptz not null default now()
);

-- ---------- HABIT ----------
create table if not exists habits (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references profiles(id) on delete cascade,
  nama               text not null,
  frekuensi          text not null default 'harian' check (frekuensi in ('harian','mingguan')),
  target_per_minggu  int  not null default 7 check (target_per_minggu between 1 and 7),
  warna              text default '#888888',
  icon               text default '✅',
  aktif              boolean not null default true,
  target_id          uuid,
  urutan             int not null default 0,
  created_at         timestamptz not null default now()
);

create table if not exists habit_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references profiles(id) on delete cascade,
  habit_id   uuid not null references habits(id) on delete cascade,
  tanggal    date not null,
  done       boolean not null default true,
  catatan    text,
  created_at timestamptz not null default now(),
  unique (habit_id, tanggal)
);

-- ---------- GYM & SPORT ----------
create table if not exists workouts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references profiles(id) on delete cascade,
  tanggal       date not null default current_date,
  jenis         text not null,           -- gym, lari, badminton, renang, dll
  durasi_menit  int,
  kalori        int,
  catatan       text,
  created_at    timestamptz not null default now()
);

create table if not exists workout_sets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references profiles(id) on delete cascade,
  workout_id  uuid not null references workouts(id) on delete cascade,
  exercise    text not null,
  set_ke      int  not null default 1,
  reps        int,
  beban_kg    numeric(6,2),
  jarak_km    numeric(6,2),
  created_at  timestamptz not null default now()
);

-- ---------- PERSONAL FINANCE (IDR) ----------
create table if not exists accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references profiles(id) on delete cascade,
  nama        text not null,
  tipe        text not null default 'bank' check (tipe in ('cash','bank','ewallet','lainnya')),
  saldo_awal  numeric(16,2) not null default 0,
  aktif       boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists fin_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references profiles(id) on delete cascade,
  nama        text not null,
  tipe        text not null check (tipe in ('in','out')),
  icon        text default '💰',
  created_at  timestamptz not null default now()
);

create table if not exists wishlist (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references profiles(id) on delete cascade,
  nama            text not null,
  harga_idr       numeric(16,2) not null default 0,
  prioritas       int not null default 2 check (prioritas between 1 and 3),
  link            text,
  gambar_url      text,
  dana_terkumpul  numeric(16,2) not null default 0,
  status          text not null default 'wish' check (status in ('wish','nabung','terbeli')),
  created_at      timestamptz not null default now()
);

create table if not exists transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references profiles(id) on delete cascade,
  account_id   uuid not null references accounts(id) on delete restrict,
  category_id  uuid references fin_categories(id) on delete set null,
  tipe         text not null check (tipe in ('in','out')),
  jumlah_idr   numeric(16,2) not null check (jumlah_idr > 0),
  tanggal      date not null default current_date,
  catatan      text,
  wishlist_id  uuid references wishlist(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references profiles(id) on delete cascade,
  category_id  uuid not null references fin_categories(id) on delete cascade,
  bulan        text not null check (bulan ~ '^\d{4}-\d{2}$'),   -- YYYY-MM
  limit_idr    numeric(16,2) not null,
  unique (user_id, category_id, bulan)
);

-- ---------- INVESTMENT (multi-currency) ----------
create table if not exists investments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references profiles(id) on delete cascade,
  nama        text not null,
  jenis       text not null check (jenis in ('saham','reksadana','emas','crypto','deposito','obligasi','lainnya')),
  currency    text not null default 'IDR' check (currency in ('IDR','USD','CRYPTO')),
  symbol      text,          -- BBCA, AAPL, bitcoin (id CoinGecko)
  platform    text,
  created_at  timestamptz not null default now()
);

create table if not exists invest_txns (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references profiles(id) on delete cascade,
  investment_id  uuid not null references investments(id) on delete cascade,
  tipe           text not null check (tipe in ('beli','jual')),
  unit           numeric(20,8) not null,
  harga          numeric(20,8) not null,   -- per unit, dalam currency investasi (crypto: USD)
  fee            numeric(16,2) not null default 0,
  tanggal        date not null default current_date,
  catatan        text,
  created_at     timestamptz not null default now()
);

create table if not exists invest_prices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references profiles(id) on delete cascade,
  investment_id  uuid not null references investments(id) on delete cascade,
  tanggal        date not null default current_date,
  harga          numeric(20,8) not null,
  unique (investment_id, tanggal)
);

-- Kurs: data referensi bersama (bukan data pribadi)
create table if not exists fx_rates (
  tanggal  date not null,
  pair     text not null,          -- 'USDIDR'
  rate     numeric(16,6) not null,
  primary key (tanggal, pair)
);

-- ---------- TODO & TARGET ----------
create table if not exists targets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references profiles(id) on delete cascade,
  judul           text not null,
  kategori        text,
  deskripsi       text,
  deadline        date,
  tipe_progress   text not null default 'manual'
                  check (tipe_progress in ('manual','habit','finance','invest','todo')),
  nilai_target    numeric(16,2),
  nilai_sekarang  numeric(16,2) not null default 0,
  status          text not null default 'aktif' check (status in ('aktif','tercapai','batal')),
  created_at      timestamptz not null default now()
);

create table if not exists todos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references profiles(id) on delete cascade,
  judul       text not null,
  tanggal     date not null default current_date,
  prioritas   int not null default 2 check (prioritas between 1 and 3),
  done        boolean not null default false,
  done_at     timestamptz,
  target_id   uuid references targets(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table habits drop constraint if exists habits_target_fk;
alter table habits add constraint habits_target_fk
  foreign key (target_id) references targets(id) on delete set null;

-- ---------- INDEX ----------
create index if not exists idx_habit_logs_user_tgl  on habit_logs (user_id, tanggal);
create index if not exists idx_workouts_user_tgl    on workouts (user_id, tanggal);
create index if not exists idx_txn_user_tgl         on transactions (user_id, tanggal);
create index if not exists idx_todos_user_tgl       on todos (user_id, tanggal);
create index if not exists idx_invest_txns_inv      on invest_txns (investment_id);

-- =========================================================
-- RLS
-- =========================================================

-- Profiles: semua member boleh lihat, hanya edit milik sendiri
alter table profiles enable row level security;
drop policy if exists p_profiles_select on profiles;
drop policy if exists p_profiles_update on profiles;
create policy p_profiles_select on profiles for select to authenticated using (true);
create policy p_profiles_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Semua tabel ber-user_id: baca semua (pantau), tulis milik sendiri
do $$
declare t text;
begin
  foreach t in array array[
    'habits','habit_logs','workouts','workout_sets','accounts','fin_categories',
    'wishlist','transactions','budgets','investments','invest_txns','invest_prices',
    'targets','todos'
  ] loop
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

-- fx_rates: data bersama, semua member boleh baca & update kurs
alter table fx_rates enable row level security;
drop policy if exists p_fx_select on fx_rates;
drop policy if exists p_fx_write  on fx_rates;
drop policy if exists p_fx_update on fx_rates;
create policy p_fx_select on fx_rates for select to authenticated using (true);
create policy p_fx_write  on fx_rates for insert to authenticated with check (true);
create policy p_fx_update on fx_rates for update to authenticated using (true) with check (true);

-- Cegah relasi silang: data anak harus milik user yang sama dengan induknya
create or replace function enforce_same_owner() returns trigger
language plpgsql security definer set search_path = public as $$
declare parent_owner uuid;
begin
  execute format('select user_id from %I where id = $1', TG_ARGV[0])
    into parent_owner using (to_jsonb(new) ->> TG_ARGV[1])::uuid;
  if parent_owner is not null and parent_owner <> new.user_id then
    raise exception 'Relasi ke data milik user lain tidak diizinkan';
  end if;
  return new;
end $$;

drop trigger if exists trg_owner_habit_logs on habit_logs;
create trigger trg_owner_habit_logs before insert or update on habit_logs
  for each row execute function enforce_same_owner('habits','habit_id');
drop trigger if exists trg_owner_sets on workout_sets;
create trigger trg_owner_sets before insert or update on workout_sets
  for each row execute function enforce_same_owner('workouts','workout_id');
drop trigger if exists trg_owner_txn on transactions;
create trigger trg_owner_txn before insert or update on transactions
  for each row execute function enforce_same_owner('accounts','account_id');
drop trigger if exists trg_owner_inv_txn on invest_txns;
create trigger trg_owner_inv_txn before insert or update on invest_txns
  for each row execute function enforce_same_owner('investments','investment_id');
drop trigger if exists trg_owner_inv_price on invest_prices;
create trigger trg_owner_inv_price before insert or update on invest_prices
  for each row execute function enforce_same_owner('investments','investment_id');
