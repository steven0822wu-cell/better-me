import { requireSession, loadProfiles } from './auth.js';
import { state, setViewing, onChange } from './state.js';
import { applyTheme, applyCachedTheme } from './theme.js';
import { getUsdIdr } from './currency.js';
import { toast } from './ui.js';
import { buildAmbient } from './fx.js';
import home from './modules/home.js';
import settings from './modules/settings.js';
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
const MODULES = { home, settings };

const $ = s => document.querySelector(s);

async function init() {
  const session = await requireSession();
  if (!session) return;

  let profiles;
  try { profiles = await loadProfiles(); }
  catch (e) { return fatal('Gagal memuat profil: ' + e.message); }

  state.me = profiles.find(p => p.id === session.user.id);
  if (!state.me) return fatal('Akun ini belum punya profil. Jalankan sql/02_setup_akun.sql.');
  state.other = profiles.find(p => p.id !== state.me.id) || null;

  applyTheme(state.me.theme);
  buildAmbient();
  getUsdIdr(); // pre-load kurs di background

  buildNav();
  buildViewSwitch();
  onChange(() => { updateSwitch(); render(); });
  setViewing(state.me);

  window.addEventListener('hashchange', render);
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

function buildViewSwitch() {
  const box = $('#view-switch');
  if (!state.other) { box.hidden = true; return; }
  box.innerHTML = `
    <button data-who="me">Data Saya</button>
    <button data-who="other">👁 Pantau ${state.other.display_name}</button>`;
  box.querySelector('[data-who="me"]').onclick = () => setViewing(state.me);
  box.querySelector('[data-who="other"]').onclick = () => setViewing(state.other);
}

function updateSwitch() {
  const box = $('#view-switch');
  box.querySelectorAll('button').forEach(b => {
    const isMe = b.dataset.who === 'me';
    b.classList.toggle('active', isMe ? !state.readOnly : state.readOnly);
  });
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
  Promise.resolve(mod.render(el, state)).catch(e => {
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
