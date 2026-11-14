export const THEMES = [
  { id: 'hero',     nama: 'Hero',             emoji: '🦸', desc: 'Merah-emas ala komik, penuh tenaga' },
  { id: 'oldmoney', nama: 'Old Money',        emoji: '🎩', desc: 'Krem, hijau tua & emas, klasik mewah' },
  { id: 'supercar', nama: 'Supercar',         emoji: '🏎️', desc: 'Carbon hitam, aksen racing' },
  { id: 'zen',      nama: 'Zen Ink 水墨',      emoji: '🖌️', desc: 'Kertas, tinta & stempel merah' },
  { id: 'cyber',    nama: 'Cyberpunk Neon',   emoji: '🌃', desc: 'Gelap dengan glow neon' },
  { id: 'midnight', nama: 'Midnight Minimal', emoji: '🌙', desc: 'Dark mode bersih & tenang' },
  { id: 'forest',   nama: 'Forest Calm',      emoji: '🌲', desc: 'Hijau alam & earth tone' }
];

const KEY = 'bm_theme';

export function applyTheme(id) {
  const valid = THEMES.some(t => t.id === id) ? id : 'midnight';
  document.documentElement.dataset.theme = valid;
  try { localStorage.setItem(KEY, valid); } catch {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
}

// Pakai tema terakhir dulu supaya tidak "kedip" sebelum profil termuat
export function applyCachedTheme() {
  let t = 'midnight';
  try { t = localStorage.getItem(KEY) || t; } catch {}
  applyTheme(t);
}
