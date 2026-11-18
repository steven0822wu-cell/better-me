-- =========================================================
-- BETTER ME — Perhitungan Gaji Mengajar (di halaman Finance)
-- Murni pencatatan: TIDAK memengaruhi saldo / transaksi Finance.
-- Jalankan SEKALI di Supabase SQL Editor (aman dijalankan ulang).
-- =========================================================

-- Daftar kelas + cara hitung tarifnya
create table if not exists salary_classes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references profiles(id) on delete cascade,
  nama        text not null,
  jenis_tarif text not null default 'murid_bulan'
              check (jenis_tarif in ('murid_bulan', 'murid_pertemuan', 'kelas_pertemuan', 'kelas_bulan')),
  tarif       numeric(14,2) not null default 0 check (tarif >= 0),
  bagi_hasil  numeric(5,2) not null default 100 check (bagi_hasil between 0 and 100),  -- % bagian saya
  aktif       boolean not null default true,
  urutan      int not null default 0,
  catatan     text,
  created_at  timestamptz not null default now()
);

-- Slip gaji per bulan (rincian disimpan apa adanya, jadi riwayat tidak berubah walau tarif kelas diubah)
create table if not exists salary_slips (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references profiles(id) on delete cascade,
  bulan         text not null check (bulan ~ '^\d{4}-\d{2}$'),        -- YYYY-MM
  items         jsonb not null default '[]'::jsonb,                  -- per kelas: tarif, murid, pertemuan, bagi hasil, hasil
  potongan_pct  numeric(5,2) not null default 0 check (potongan_pct between 0 and 100),
  potongan      jsonb not null default '[]'::jsonb,                  -- [{nama, jumlah}]
  tambahan      jsonb not null default '[]'::jsonb,                  -- [{nama, jumlah}] bonus, transport, dll.
  total_kotor   numeric(14,2) not null default 0,
  total_bagian  numeric(14,2) not null default 0,
  total_bersih  numeric(14,2) not null default 0,
  catatan       text,
  updated_at    timestamptz not null default now(),
  unique (user_id, bulan)
);
create index if not exists idx_salary_slips_user on salary_slips (user_id, bulan desc);

-- RLS: semua member boleh lihat (mode pantau), hanya pemilik yang boleh ubah
do $$
declare t text;
begin
  foreach t in array array['salary_classes', 'salary_slips'] loop
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
