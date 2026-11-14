# BETTER ME PROJECT — Fase 1 (Fondasi)

Vanilla HTML/CSS/JS + Supabase + Netlify · Role: **Steve** & **Pelaa**

## Isi Fase 1
- Login 2 akun (signup tertutup)
- Data 100% terpisah per user, **saling pantau read-only** (dijaga UI + RLS database)
- Toggle header: **Data Saya / 👁 Pantau [nama]** + banner mode pantau
- 7 tema per user: Hero, Old Money, Supercar, Zen Ink 水墨, Cyberpunk Neon, Midnight Minimal, Forest Calm
- Tampilan mata uang IDR ⇄ USD (kurs harian di-cache di `fx_rates`) + helper harga crypto (CoinGecko)
- Layout responsive: sidebar (desktop) / bottom nav (HP), PWA bisa di-install
- Schema lengkap untuk semua 7 modul sudah siap

## Setup
1. **Supabase** → buat project baru → SQL Editor → jalankan `sql/01_schema.sql`
2. **Authentication → Providers → Email**: matikan *Allow new users to sign up*
3. **Authentication → Users → Add user** (centang *Auto Confirm*) untuk Steve & Pelaa
4. Jalankan `sql/02_setup_akun.sql` (email default: steve@betterme.app & pelaa@betterme.app)
5. Isi `js/config.js` (URL + anon key dari Project Settings → API)
6. Tes lokal: `npx serve .` lalu buka `http://localhost:3000`
7. **Netlify**: drag & drop folder ini, atau hubungkan repo (publish dir = `.`)

## Aturan untuk modul berikutnya
- Semua query baca pakai `.eq('user_id', state.viewing.id)`
- Semua tombol/form edit diberi atribut `data-edit` → otomatis hilang di mode pantau
- Sebelum insert/update/delete panggil `assertCanEdit()` dari `js/state.js`
- `user_id` terisi otomatis oleh default `auth.uid()` — tidak perlu dikirim

## Struktur
```
index.html            login
app.html              shell aplikasi
css/themes.css        7 tema (CSS variables)
css/base.css          layout & komponen
js/config.js          kredensial Supabase
js/app.js             init, router hash, nav, switch pantau
js/state.js           me / other / viewing / readOnly
js/currency.js        kurs USD-IDR, harga crypto, format uang
js/modules/           home, settings, placeholder (modul lain menyusul)
sql/                  schema + setup akun
```
