-- =========================================================
-- Jalankan SETELAH membuat 2 user di:
-- Supabase → Authentication → Users → Add user → Create new user
--   Steve : steve@betterme.app  (centang Auto Confirm User)
--   Pelaa : pelaa@betterme.app  (centang Auto Confirm User)
-- Kalau pakai email lain, ganti di sini DAN di js/config.js (ROLE_EMAILS)
-- =========================================================

insert into profiles (id, display_name, theme)
select id, 'Steve', 'supercar' from auth.users where email = 'steve@betterme.app'
on conflict (id) do update set display_name = excluded.display_name;

insert into profiles (id, display_name, theme)
select id, 'Pelaa', 'oldmoney' from auth.users where email = 'pelaa@betterme.app'
on conflict (id) do update set display_name = excluded.display_name;

-- Cek hasil: harus muncul 2 baris
select p.display_name, u.email, p.theme from profiles p join auth.users u on u.id = p.id;
