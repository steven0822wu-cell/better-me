import { state } from '../state.js';
import { persona, celebrate, sticker } from '../fx.js';
import { sb } from '../supabase.js';
import { today } from '../date.js';
import { forDate, nextOf, hhmm, statusOf } from './todo-schedule.js';
import { summaryFor, streakOf } from './habit.js';
import { jenisOf } from './gym.js';
import { balanceOf, monthTotals } from './finance.js';
import { money, getUsdIdr } from '../currency.js';
import { position } from './invest.js';
import { fetchAll } from '../db.js';
import { relLabel } from '../date.js';
import { addDays } from '../date.js';

const SAPAAN = () => {
  const h = new Date().getHours();
  if (h < 4)  return ['Masih begadang', '🦉'];
  if (h < 11) return ['Selamat pagi', '☀️'];
  if (h < 15) return ['Selamat siang', '🌤️'];
  if (h < 18) return ['Selamat sore', '🌇'];
  return ['Selamat malam', '🌙'];
};

// Kalimat penyemangat — berganti tiap hari
const QUOTES = [
  'Disiplin hari ini, bebas besok.',
  'Tidak perlu sempurna, yang penting konsisten.',
  'Satu persen lebih baik tiap hari itu luar biasa dalam setahun.',
  'Mulai dari yang kecil, tapi mulai sekarang.',
  'Uang yang dicatat adalah uang yang terkendali.',
  'Badan sehat, pikiran jernih, keputusan tajam.',
  'Target tanpa jadwal cuma angan-angan.',
  'Hari yang buruk tetap lebih baik dari hari yang dilewatkan.',
  'Fokus ke proses, hasil akan menyusul.',
  'Kamu sedang membangun versi terbaik dirimu.',
  '一步一步来 — selangkah demi selangkah.',
  'Bandingkan dirimu dengan kamu yang kemarin, bukan orang lain.',
  'Kebiasaan kecil, dampak besar.',
  'Investasi terbaik adalah investasi pada diri sendiri.'
];

const quoteOfDay = () => {
  const d = new Date();
  const n = Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
  return QUOTES[n % QUOTES.length];
};

export default {
  render(el) {
    const v = state.viewing;
    const [sapa, emoji] = SAPAAN();
    const tgl = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const judul = state.readOnly
      ? `Hari ini ${v.display_name} <span class="wave">👀</span>`
      : `${sapa}, ${v.display_name} <span class="wave">${emoji}</span>`;

    el.innerHTML = `
      <section class="hero-block">
        <span class="mascot" title="Tap aku!">${persona().mascot}</span>
        <p class="eyebrow">${tgl}</p>
        <h1>${judul}</h1>
        <p class="muted">Satu langkah kecil tiap hari → better me.</p>
        <div class="quote"><span class="quote-mark">❝</span><span>${quoteOfDay()}</span></div>
        <a class="next-sched" id="next-sched" href="#/todo" hidden></a>
      </section>

      <div class="grid">
        ${[
          ['✅', 'Habit hari ini', 'habit'],
          ['📝', 'To-do hari ini', 'todo'],
          ['🏋️', 'Latihan terakhir', 'gym'],
          ['💰', 'Saldo bulan ini', 'finance'],
          ['📈', 'Portofolio', 'invest'],
          ['🎯', 'Target aktif', 'target'],
          ['🎁', 'Wishlist', 'wishlist']
        ].map(([i, l, r], idx) => tile(i, l, '—', r, idx)).join('')}
      </div>`;

    loadStats(el);

    // Tap maskot → stiker + confetti
    const m = el.querySelector('.mascot');
    m.onclick = e => {
      const r = m.getBoundingClientRect();
      Math.random() < 0.35
        ? celebrate(r.left + r.width / 2, r.top + r.height / 2)
        : sticker(null, r.left + r.width / 2, r.top + r.height + 20);
    };
  }
};

function tile(icon, label, value, route, i) {
  return `
    <a class="card tile" href="#/${route}" style="--i:${i}" data-tile="${route}">
      <span class="tile-icon">${icon}</span>
      <span class="tile-label">${label}</span>
      <span class="tile-value">${value}</span>
    </a>`;
}

// Isi angka di kartu dari data asli (modul yang sudah jadi)
async function loadStats(el) {
  const uid = state.viewing.id;
  loadNextSchedule(el, uid);
  loadHabits(el, uid);
  loadWorkout(el, uid);
  loadFinance(el, uid);
  loadInvest(el, uid);
  loadWishlist(el, uid);
  loadTargets(el, uid);
  const { data } = await sb.from('todos').select('done').eq('user_id', uid).eq('tanggal', today());
  if (data) {
    const done = data.filter(t => t.done).length;
    setTile(el, 'todo', data.length ? `${done} / ${data.length}` : 'Kosong',
      data.length ? Math.round(done / data.length * 100) : null);
  }
}

function setTile(el, route, value, pct) {
  if (!el.isConnected) return;
  const tile = el.querySelector(`[data-tile="${route}"]`);
  if (!tile) return;
  tile.querySelector('.tile-value').textContent = value;
  if (pct != null) {
    let bar = tile.querySelector('.progress');
    if (!bar) { bar = document.createElement('div'); bar.className = 'progress progress-sm'; bar.innerHTML = '<i></i>'; tile.appendChild(bar); }
    requestAnimationFrame(() => bar.firstChild.style.width = pct + '%');
  }
}

async function loadNextSchedule(el, uid) {
  const { data } = await sb.from('schedules').select('*').eq('user_id', uid);
  if (!data) return;
  const t = today();
  const items = forDate(data, t);
  const live = items.find(s => statusOf(s, t) === 'live');
  const next = nextOf(items, t);
  const box = el.querySelector('#next-sched');
  if (!box || (!live && !next)) return;
  const s = live || next;
  box.innerHTML = `<span class="ns-icon">${s.icon}</span>
    <span><small>${live ? '● Sedang berlangsung' : 'Jadwal berikutnya'}</small>
    <b>${hhmm(s.jam_mulai)} · ${s.judul.replace(/[<>&]/g, '')}</b></span>`;
  box.classList.toggle('live', !!live);
  box.style.setProperty('--c', s.warna);
  box.hidden = false;
}

async function loadHabits(el, uid) {
  const [h, l] = await Promise.all([
    sb.from('habits').select('*').eq('user_id', uid).eq('aktif', true),
    sb.from('habit_logs').select('habit_id,tanggal').eq('user_id', uid).gte('tanggal', addDays(today(), -60))
  ]);
  if (!h.data) return;
  if (!h.data.length) return setTile(el, 'habit', 'Belum ada', null);
  const logs = new Map();
  (l.data || []).forEach(r => { if (!logs.has(r.habit_id)) logs.set(r.habit_id, new Set()); logs.get(r.habit_id).add(r.tanggal); });
  const { total, done } = summaryFor(logs, h.data, today());
  const best = Math.max(0, ...h.data.filter(x => x.frekuensi === 'harian').map(x => streakOf(logs, x)));
  setTile(el, 'habit', total ? `${done} / ${total}` : 'Beres ✓', total ? Math.round(done / total * 100) : 100);
  if (best) {
    const lbl = el.querySelector('[data-tile="habit"] .tile-label');
    if (lbl) lbl.textContent = `Habit hari ini · 🔥 ${best}`;
  }
}

async function loadWorkout(el, uid) {
  const { data } = await sb.from('workouts').select('jenis,tanggal,durasi_menit').eq('user_id', uid)
    .order('tanggal', { ascending: false }).limit(1);
  if (!data) return;
  if (!data.length) return setTile(el, 'gym', 'Belum ada', null);
  const w = data[0];
  setTile(el, 'gym', `${jenisOf(w.jenis).icon} ${relLabel(w.tanggal)}`, null);
  const lbl = el.querySelector('[data-tile="gym"] .tile-label');
  if (lbl) lbl.textContent = `Latihan terakhir · ${w.jenis}${w.durasi_menit ? ' ' + w.durasi_menit + 'm' : ''}`;
}

async function loadFinance(el, uid) {
  const [a, t] = await Promise.all([
    sb.from('accounts').select('*').eq('user_id', uid).eq('aktif', true),
    fetchAll(() => sb.from('transactions').select('tipe,jumlah_idr,account_id,ke_account_id,tanggal').eq('user_id', uid))
  ]);
  if (!a.data) return;
  if (!a.data.length) return setTile(el, 'finance', 'Belum ada akun', null);
  const view = state.me?.currency_view;
  const total = a.data.reduce((s, x) => s + balanceOf(x, t.data || []), 0);
  const { net } = monthTotals(t.data || [], today().slice(0, 7));
  setTile(el, 'finance', money(total, view), null);
  const lbl = el.querySelector('[data-tile="finance"] .tile-label');
  if (lbl) lbl.innerHTML = `Saldo total · bulan ini <span class="${net >= 0 ? 'amt-in' : 'amt-out'}">${net >= 0 ? '+' : '−'}${money(Math.abs(net), view)}</span>`;
}

async function loadInvest(el, uid) {
  const [a, t, p, rate] = await Promise.all([
    sb.from('investments').select('*').eq('user_id', uid),
    fetchAll(() => sb.from('invest_txns').select('*').eq('user_id', uid)),
    fetchAll(() => sb.from('invest_prices').select('*').eq('user_id', uid)),
    getUsdIdr()
  ]);
  if (!a.data) return;
  if (!a.data.length) return setTile(el, 'invest', 'Belum ada', null);
  const group = (rows) => { const m = new Map(); (rows || []).forEach(x => { if (!m.has(x.investment_id)) m.set(x.investment_id, []); m.get(x.investment_id).push(x); }); return m; };
  const tm = group(t.data), pm = group(p.data);
  let val = 0, cost = 0;
  a.data.forEach(x => { const r = position(x, tm.get(x.id), pm.get(x.id), {}, rate); val += r.valueIdr; cost += r.costIdr; });
  const view = state.me?.currency_view;
  setTile(el, 'invest', money(val, view), null);
  const pct = cost ? (val - cost) / cost * 100 : 0;
  const lbl = el.querySelector('[data-tile="invest"] .tile-label');
  if (lbl && cost) lbl.innerHTML = `Portofolio · <span class="${pct >= 0 ? 'amt-in' : 'amt-out'}">${pct >= 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')}%</span>`;
}

async function loadWishlist(el, uid) {
  const { data } = await sb.from('wishlist').select('harga_idr,dana_terkumpul,status').eq('user_id', uid).neq('status', 'terbeli');
  if (!data) return;
  if (!data.length) return setTile(el, 'wishlist', 'Kosong', null);
  const total = data.reduce((s, w) => s + Number(w.harga_idr), 0);
  const saved = data.reduce((s, w) => s + Math.min(Number(w.dana_terkumpul), Number(w.harga_idr)), 0);
  const ready = data.filter(w => Number(w.harga_idr) && Number(w.dana_terkumpul) >= Number(w.harga_idr)).length;
  setTile(el, 'wishlist', `${data.length} impian`, total ? Math.round(saved / total * 100) : 0);
  const lbl = el.querySelector('[data-tile="wishlist"] .tile-label');
  if (lbl) lbl.textContent = ready ? `Wishlist · 🎉 ${ready} siap dibeli` : `Wishlist · ${total ? Math.round(saved / total * 100) : 0}% terkumpul`;
}

async function loadTargets(el, uid) {
  const { data } = await sb.from('targets').select('judul,nilai_target,nilai_sekarang,deadline').eq('user_id', uid).eq('status', 'aktif');
  if (!data) return;
  if (!data.length) return setTile(el, 'target', 'Belum ada', null);
  const pcts = data.map(t => Number(t.nilai_target) ? Math.min(100, Number(t.nilai_sekarang) / Number(t.nilai_target) * 100) : 0);
  const avg = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
  setTile(el, 'target', `${data.length} aktif`, avg);
  const next = data.filter(t => t.deadline && t.deadline >= today()).sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
  const lbl = el.querySelector('[data-tile="target"] .tile-label');
  if (lbl) lbl.textContent = next ? `Target · terdekat: ${next.judul}` : `Target · rata-rata ${avg}%`;
}
