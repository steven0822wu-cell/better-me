import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Sesi login (JWT) berlaku ±1 jam lalu diperpanjang otomatis. Kalau laptop/HP tidur
// atau server Supabase sempat gangguan, perpanjangan bisa terlewat → "JWT expired".
// Di sini: kalau ada permintaan ditolak karena JWT kedaluwarsa, sesi diperbarui
// lalu permintaan diulang sekali — jadi data tetap tampil tanpa perlu login ulang.
let refreshing = null;
function refreshOnce() {
  refreshing ??= sb.auth.refreshSession()
    .then(({ data, error }) => (error || !data.session) ? null : data.session.access_token)
    .catch(() => null)
    .finally(() => setTimeout(() => { refreshing = null; }, 1000));
  return refreshing;
}

async function fetchWithRefresh(input, init = {}) {
  const res = await fetch(input, init);
  const url = typeof input === 'string' ? input : input.url;
  if (res.status !== 401 || url.includes('/auth/v1/')) return res;
  const text = await res.clone().text();
  if (!/jwt expired|PGRST301|PGRST303|invalid jwt|exp" claim/i.test(text)) return res;

  const token = await refreshOnce();
  if (!token) {                          // sesi benar-benar habis → kembali ke halaman login
    if (!location.pathname.endsWith('index.html') && !location.pathname.endsWith('/')) {
      sessionStorage.setItem('bm_relogin', '1');
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});   // hapus sesi lama supaya tidak bolak-balik
      location.href = 'index.html';
    }
    return res;
  }
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
  global: { fetch: fetchWithRefresh }
});

// Saat aplikasi dibuka lagi (bangun dari tidur / pindah tab), pastikan sesi masih segar
const wake = () => { if (document.visibilityState === 'visible') sb.auth.getSession().catch(() => {}); };
document.addEventListener('visibilitychange', wake);
window.addEventListener('online', wake);
window.addEventListener('focus', wake);
