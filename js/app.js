import { requireSession, loadProfiles } from './auth.js';
import { state, setViewing, onChange } from './state.js';
import { applyTheme, applyCachedTheme } from './theme.js';
import { getUsdIdr } from './currency.js';
import { toast } from './ui.js';
import { buildAmbient } from './fx.js';
import { syncSubscription } from './push.js';
import home from './modules/home.js';
import settings from './modules/settings.js';
import todo from './modules/todo.js';
import habit from './modules/habit.js';
import gym from './modules/gym.js';
import finance from './modules/finance.js';
import invest from './modules/invest.js';
import wishlist from './modules/wishlist.js';
import target from './modules/target.js';
import { placeholder } from './modules/placeholder.js';

applyCachedTheme();

export const NAV = [
  { route: 'home',     icon: '🏠', label: 'Home' },
  { route: 'todo',     icon: '📝', label: 'To-do' },
  { route: 'habit',    icon: '✅', label: 'Habit' },
  { route: 'gym',      icon: '🏋️', label: 'Gym' },
  { route: 'finance',  icon: '💰', label: 'Finance' },
  { route: 'invest',   icon: '📈', label: 'Invest' },
  { route: 'target',   icon: '🎯', label: 'Target' },
  { route: 'wishlist', icon: '🎁', label: 'Wishlist' },
  { route: 'settings', icon: '⚙️', label: 'Setting' }
];

// Modul yang sudah jadi; sisanya placeholder sampai fasenya
const MODULES = { home, settings, todo, habit, gym, finance, invest, wishlist, target };

const $ = s => document.querySelector(s);

async function init() {
  const session = await requireSession();
  if (!session) return;

  let profiles;
  try { profiles = await loadProfiles(); }
  catch (e) { return fatal('Gagal memuat profil: ' + e.message); }

  state.me = profiles.find(p => p.id === session.user.id);
  if (!state.me) return fatal('Akun ini belum punya profil. Jalankan sql/02_setup_akun.sql.');
  state.all = profiles;
  state.others = visibleOthers(profiles, state.me);
  state.refreshProfiles = refreshProfiles;

  applyTheme(state.me.theme);
  buildAmbient();
  getUsdIdr(); // pre-load kurs di background

  buildNav();
  buildViewSwitch();
  onChange(() => { updateSwitch(); render(); });
  setViewing(state.me);

  window.addEventListener('hashchange', render);
  syncSubscription();
  navigator.serviceWorker?.addEventListener('message', e => {
    if (e.data?.type === 'navigate' && e.data.url) location.href = e.data.url;
  });
  document.body.classList.remove('loading');
}

function buildNav() {
  const html = NAV.map(n => `
    <a href="#/${n.route}" data-route="${n.route}">
      <span class="nav-icon">${n.icon}</span><span class="nav-label">${n.label}</span>
    </a>`).join('');
  $('#sidebar-nav').innerHTML = html;
  $('#bottom-nav').innerHTML = html;
}

// Siapa saja yang boleh dipantau (aturan sama dengan database):
// admin → semua · akun privat → tidak ada · selain itu → semua yang tidak privat
function visibleOthers(profiles, me) {
  return profiles.filter(p => p.id !== me.id && p.aktif !== false &&
    (me.is_admin || (!me.privat && !p.privat)))
    .sort((a, b) => (b.is_admin ? 1 : 0) - (a.is_admin ? 1 : 0) || String(a.created_at).localeCompare(String(b.created_at)));
}

function buildViewSwitch() {
  const box = $('#view-switch');
  const others = state.others;
  box.hidden = !others.length;
  if (!others.length) { box.innerHTML = ''; return; }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  box.innerHTML = `<button data-who="me">Data Saya</button>` + (others.length === 1
    ? others.map(o => `<button data-who="${o.id}">👁 Pantau ${esc(o.display_name)}</button>`).join('')
    : `<select class="who-select" aria-label="Pantau akun"><option value="">👁 Pantau…</option>
        ${others.map(o => `<option value="${o.id}">👁 ${esc(o.display_name)}</option>`).join('')}</select>`);
  box.querySelectorAll('button[data-who]').forEach(b => b.onclick = () =>
    setViewing(b.dataset.who === 'me' ? state.me : others.find(o => o.id === b.dataset.who)));
  const sel = box.querySelector('select');
  if (sel) sel.onchange = () => setViewing(others.find(o => o.id === sel.value) || state.me);
}

// Dipanggil setelah admin mengubah personel / privasi
async function refreshProfiles() {
  try {
    const profiles = await loadProfiles();
    state.all = profiles;
    const me = profiles.find(p => p.id === state.me.id);
    if (me) Object.assign(state.me, me);
    state.others = visibleOthers(profiles, state.me);
    const still = state.others.find(o => o.id === state.viewing?.id);
    buildViewSwitch();
    if (state.readOnly && !still) setViewing(state.me); else updateSwitch();
  } catch (e) { console.error(e); }
}

function updateSwitch() {
  const box = $('#view-switch');
  box.querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.who === 'me' ? !state.readOnly : b.dataset.who === state.viewing?.id));
  const sel = box.querySelector('select');
  if (sel) { sel.value = state.readOnly ? state.viewing.id : ''; sel.classList.toggle('active', state.readOnly); }
  const banner = $('#readonly-banner');
  banner.hidden = !state.readOnly;
  if (state.readOnly) banner.textContent = `👁 Mode pantau — kamu melihat data ${state.viewing.display_name} (hanya baca)`;
}

function currentRoute() {
  const r = location.hash.replace(/^#\/?/, '') || 'home';
  return NAV.some(n => n.route === r) ? r : 'home';
}

function render() {
  const route = currentRoute();
  document.querySelectorAll('[data-route]').forEach(a =>
    a.classList.toggle('active', a.dataset.route === route));

  // Pengaturan selalu milik sendiri — sembunyikan banner pantau di sana
  $('#readonly-banner').hidden = !state.readOnly || route === 'settings';

  const mod = MODULES[route] || placeholder(route);
  const el = $('#view');
  el.innerHTML = '';
  el.classList.remove('fx-enter'); void el.offsetWidth; el.classList.add('fx-enter');
  // Tiap render dapat wadah baru: kalau user pindah halaman sebelum data selesai dimuat,
  // halaman lama menulis ke wadah yang sudah dilepas (tidak error, tidak bentrok)
  const page = document.createElement('div');
  page.className = 'page';
  el.appendChild(page);
  Promise.resolve(mod.render(page, state)).catch(e => {
    if (!page.isConnected) return;   // halaman sudah ditinggal — abaikan
    console.error(e);
    toast(e.message, 'error');
  });
  el.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function fatal(msg) {
  document.body.classList.remove('loading');
  $('#view').innerHTML = `<section class="card empty"><h2>Ups</h2><p>${msg}</p>
    <a class="btn" href="index.html">Kembali ke login</a></section>`;
}

init();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
