// =========================================================
// FX — animasi ambient, stiker pop-up & confetti per tema
// Pakai: import { sticker, celebrate } from './fx.js'
//   sticker()            → stiker acak sesuai tema
//   sticker('Mantap!')   → stiker teks custom
//   celebrate()          → confetti warna tema (buat pencapaian)
// =========================================================

const KEY = 'bm_fx';

// Kepribadian tiap tema
export const PERSONA = {
  hero: {
    mascot: '🦸', words: ['POW!', 'BOOM!', 'WHAM!', 'HERO!', 'KAPOW!'],
    particles: ['✦', '★', '⚡'], ambient: 'rise'
  },
  oldmoney: {
    mascot: '🎩', words: ['Splendid.', 'Bravo.', 'Très bien.', 'Impeccable.', 'Well done.'],
    particles: ['✧', '◆', '❦'], ambient: 'shimmer'
  },
  supercar: {
    mascot: '🏎️', words: ['VROOM!', 'TURBO!', 'NITRO!', 'FULL SPEED!', 'PIT STOP ✓'],
    particles: ['', '', ''], ambient: 'speed'
  },
  zen: {
    mascot: '🏮', words: ['好!', '加油!', '福', '很棒!', '一步一步'],
    particles: ['·', '•', '◦'], ambient: 'ink'
  },
  cyber: {
    mascot: '🤖', words: ['LEVEL UP', '+100 XP', 'SYNCED', 'UNLOCKED', 'COMBO x2'],
    particles: ['▪', '◇', '+'], ambient: 'rain'
  },
  midnight: {
    mascot: '🌙', words: ['Nice ✦', 'Done ✓', 'Keren!', 'Mantap ✦', 'On track'],
    particles: ['✦', '·', '✧'], ambient: 'stars'
  },
  forest: {
    mascot: '🌿', words: ['🌱 Tumbuh!', '🍃 Mantap!', '🌳 Kokoh!', '🌼 Indah!', '🍀 Lucky!'],
    particles: ['🍃', '🍂', '🌿'], ambient: 'leaves'
  }
};

const theme = () => document.documentElement.dataset.theme || 'midnight';
export const persona = () => PERSONA[theme()] || PERSONA.midnight;

export function fxEnabled() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setFx(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {}
  document.body.classList.toggle('no-fx', !on);
  buildAmbient();
}

// ---------- Ambient background ----------
let layer;
export function buildAmbient() {
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.prepend(layer);
  }
  layer.innerHTML = '';
  document.body.classList.toggle('no-fx', !fxEnabled());
  if (!fxEnabled()) return;

  const p = persona();
  layer.dataset.ambient = p.ambient;
  const count = innerWidth < 700 ? 12 : 22;
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    s.className = 'fx-p';
    s.textContent = p.particles[i % p.particles.length];
    s.style.setProperty('--x', Math.random() * 100 + 'vw');
    s.style.setProperty('--y', Math.random() * 100 + 'vh');
    s.style.setProperty('--d', (8 + Math.random() * 14).toFixed(1) + 's');
    s.style.setProperty('--delay', (-Math.random() * 20).toFixed(1) + 's');
    s.style.setProperty('--s', (0.6 + Math.random() * 0.9).toFixed(2));
    layer.appendChild(s);
  }
}

// Bangun ulang saat tema berubah
new MutationObserver(() => layer && buildAmbient())
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ---------- Stiker pop-up ----------
export function sticker(text, x, y) {
  if (!fxEnabled()) return;
  const p = persona();
  const el = document.createElement('div');
  el.className = 'fx-sticker';
  el.textContent = text || p.words[Math.floor(Math.random() * p.words.length)];
  const pad = Math.min(140, innerWidth / 3);
  el.style.left = Math.min(Math.max(x ?? innerWidth / 2, pad), innerWidth - pad) + 'px';
  el.style.top = (y ?? innerHeight / 2.4) + 'px';
  el.style.setProperty('--r', (Math.random() * 16 - 8).toFixed(1) + 'deg');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

// ---------- Confetti ----------
export function celebrate(x = innerWidth / 2, y = innerHeight / 2.4) {
  if (!fxEnabled()) return;
  const cs = getComputedStyle(document.documentElement);
  const colors = ['--primary', '--accent', '--success', '--text'].map(v => cs.getPropertyValue(v).trim());
  for (let i = 0; i < 36; i++) {
    const c = document.createElement('i');
    c.className = 'fx-confetti';
    const angle = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 180;
    c.style.left = x + 'px';
    c.style.top = y + 'px';
    c.style.background = colors[i % colors.length];
    c.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
    c.style.setProperty('--ty', Math.sin(angle) * dist - 60 + 'px');
    c.style.setProperty('--rot', Math.random() * 720 + 'deg');
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 1200);
  }
  sticker(null, x, y - 30);
}

// ---------- Ripple saat klik tombol ----------
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('.btn, .seg button, .theme-opt, .role-card');
  if (!b || !fxEnabled()) return;
  const r = b.getBoundingClientRect();
  const dot = document.createElement('span');
  dot.className = 'fx-ripple';
  dot.style.left = e.clientX - r.left + 'px';
  dot.style.top = e.clientY - r.top + 'px';
  b.appendChild(dot);
  setTimeout(() => dot.remove(), 600);
});
