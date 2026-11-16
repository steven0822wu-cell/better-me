-- =========================================================
-- BETTER ME — Target: progres otomatis + milestone
-- Jalankan SEKALI di Supabase SQL Editor (aman dijalankan ulang).
-- =========================================================

alter table targets add column if not exists icon        text not null default '🎯';
alter table targets add column if not exists warna       text not null default '#7c9cff';
alter table targets add column if not exists satuan      text;                              -- kg, buku, km, Rp …
alter table targets add column if not exists mulai       date not null default current_date;
alter table targets add column if not exists sumber      jsonb not null default '{}'::jsonb; -- konfigurasi progres otomatis
alter table targets add column if not exists milestones  jsonb not null default '[]'::jsonb; -- [{id, judul, done}]
alter table targets add column if not exists tercapai_at timestamptz;
alter table targets add column if not exists urutan      int not null default 0;

-- Jenis progres:
--   manual    = angka diisi sendiri          milestone = checklist langkah
--   finance   = saldo akun Finance           invest    = nilai portofolio
--   habit     = jumlah check-in habit        gym       = sesi / menit / km latihan
alter table targets drop constraint if exists targets_tipe_progress_check;
alter table targets add constraint targets_tipe_progress_check
  check (tipe_progress in ('manual', 'milestone', 'finance', 'invest', 'habit', 'gym', 'todo'));

create index if not exists idx_targets_user on targets (user_id, status);
