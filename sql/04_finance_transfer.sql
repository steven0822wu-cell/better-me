-- =========================================================
-- BETTER ME — Finance: transfer antar akun + pengaman relasi
-- Jalankan SEKALI di Supabase SQL Editor (aman dijalankan ulang).
-- =========================================================

-- Transfer: 1 baris transaksi dengan akun asal (account_id) & akun tujuan (ke_account_id)
alter table transactions add column if not exists ke_account_id uuid references accounts(id) on delete restrict;

alter table transactions drop constraint if exists transactions_tipe_check;
alter table transactions add constraint transactions_tipe_check
  check (tipe in ('in', 'out', 'transfer'));

alter table transactions drop constraint if exists transactions_transfer_check;
alter table transactions add constraint transactions_transfer_check
  check ((tipe = 'transfer') = (ke_account_id is not null)
         and (ke_account_id is null or ke_account_id <> account_id));

create index if not exists idx_txn_ke_account on transactions (ke_account_id);

-- Akun tujuan, kategori & budget harus milik user yang sama
drop trigger if exists trg_owner_txn_to on transactions;
create trigger trg_owner_txn_to before insert or update on transactions
  for each row execute function enforce_same_owner('accounts', 'ke_account_id');

drop trigger if exists trg_owner_txn_cat on transactions;
create trigger trg_owner_txn_cat before insert or update on transactions
  for each row execute function enforce_same_owner('fin_categories', 'category_id');

drop trigger if exists trg_owner_budget_cat on budgets;
create trigger trg_owner_budget_cat before insert or update on budgets
  for each row execute function enforce_same_owner('fin_categories', 'category_id');
