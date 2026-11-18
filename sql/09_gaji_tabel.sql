-- =========================================================
-- BETTER ME — Gaji model tabel (bagian/section seperti Excel)
-- Jalankan SEKALI di Supabase SQL Editor, SETELAH 08_gaji.sql.
-- Aman dijalankan ulang.
-- =========================================================

-- Daftar bagian tabel per slip, misal:
-- [{"nama":"PRIBADI","mode":"simple"}, {"nama":"TONGYI'S","mode":"bagi"}]
--   simple = Price × Qty
--   bagi   = (Price × %  − Potongan per qty) × Qty
alter table salary_slips add column if not exists sections jsonb not null default '[]'::jsonb;
