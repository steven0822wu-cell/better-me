import { sb } from '../supabase.js';
import { state, assertCanEdit } from '../state.js';
import { toast, esc, modal } from '../ui.js';
import { sticker, celebrate, persona } from '../fx.js';
import { fetchAll } from '../db.js';
import { today, addDays, weekStart, relLabel, fmtLong, fmtShort, parse } from '../date.js';

const ICONS = ['✅', '💧', '📖', '🏃', '🧘', '😴', '🀄', '✍️', '🥗', '🚭', '🍬', '💊', '🙏', '🎸', '💻', '🧹', '🌅', '📵', '💰', '❤️'];
const COLORS = ['#7c9cff', '#2f9e44', '#f59f00', '#e62429', '#b08d57', '#ff2bd6', '#00b8d9', '#845ef7'];
const SUGGEST = [
  ['Minum air 2 liter', '💧', 'harian', 7], ['Baca buku 20 menit', '📖', 'harian', 7],
  ['Olahraga', '🏃', 'mingguan', 3], ['Meditasi 10 menit', '🧘', 'harian', 7],
  ['Tidur sebelum jam 23', '😴', 'harian', 7], ['Belajar Mandarin', '🀄', 'harian', 7],
  ['Journaling', '✍️', 'harian', 7], ['Tanpa gula', '🍬', 'harian', 7], ['Ibadah', '🙏', 'harian', 7]
];
const MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365];
const DOW = ['S', 'S', 'R', 'K', 'J', 'S', 'M'];

let cur = today();
let el, habits = [], logs = new Map(); // habit_id → Set(tanggal)

// ---------- Logika murni (dipakai juga di Home) ----------
export const isDone = (logsMap, h, d) => !!logsMap.get(h.id)?.has(d);

export function weekCount(logsMap, h, ws) {
  const set = logsMap.get(h.id);
  if (!set) return 0;
  let n = 0;
  for (let i = 0; i < 7; i++) if (set.has(addDays(ws, i))) n++;
  return n;
}

// Habit yang "jatuh tempo" di tanggal d: harian, atau mingguan yang targetnya belum tercapai / dicentang hari itu
export function dueOn(logsMap, list, d) {
  const ws = weekStart(d);
  return list.filter(h => h.aktif && (h.frekuensi === 'harian' || isDone(logsMap, h, d) ||
    weekCount(logsMap, h, ws) < h.target_per_minggu));
}

export function summaryFor(logsMap, list, d) {
  const due = dueOn(logsMap, list, d);
  return { total: due.length, done: due.filter(h => isDone(logsMap, h, d)).length };
}

export function streakOf(logsMap, h) {
  const t = today();
  if (h.frekuensi === 'harian') {
    let d = isDone(logsMap, h, t) ? t : addDays(t, -1), n = 0;
    while (isDone(logsMap, h, d)) { n++; d = addDays(d, -1); }
    return n;
  }
  let ws = weekStart(t), n = 0;
  if (weekCount(logsMap, h, ws) < h.target_per_minggu) ws = addDays(ws, -7);
  while (weekCount(logsMap, h, ws) >= h.target_per_minggu) { n++; ws = addDays(ws, -7); }
  return n;
}

function longestOf(h) {
  const dates = [...(logs.get(h.id) || [])].sort();
  if (!dates.length) return 0;
  if (h.frekuensi === 'harian') {
    let best = 1, run = 1;
    for (let i = 1; i < dates.length; i++) {
      run = dates[i] === addDays(dates[i - 1], 1) ? run + 1 : 1;
      best = Math.max(best, run);
    }
    return best;
  }
  const weeks = [...new Set(dates.map(weekStart))].sort().filter(ws => weekCount(logs, h, ws) >= h.target_per_minggu);
  let best = weeks.length ? 1 : 0, run = 1;
  for (let i = 1; i < weeks.length; i++) {
    run = weeks[i] === addDays(weeks[i - 1], 7) ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

const unit = h => h.frekuensi === 'harian' ? 'hari' : 'minggu';

// ---------- Halaman ----------
export default {
  async render(root) {
    el = root;
    el.innerHTML = `
      <header class="page-head">
        <div>
          <p class="eyebrow" id="hb-date"></p>
          <h1 class="page-title" id="hb-title">Habit</h1>
        </div>
        <div class="date-nav">
          <button class="icon-btn" id="hb-prev" aria-label="Hari sebelumnya">‹</button>
          <button class="icon-btn" id="hb-next" aria-label="Hari berikutnya">›</button>
          <button class="btn btn-ghost btn-sm" id="hb-today">Hari ini</button>
        </div>
      </header>

      <section class="card hb-summary" id="hb-summary"></section>

      <div class="hb-toolbar" data-edit>
        <button class="btn" id="hb-add">＋ Habit baru</button>
        <button class="btn btn-ghost" id="hb-manage">⚙️ Kelola & urutkan</button>
      </div>

      <div class="habit-grid" id="hb-list"></div>

      <section class="card heat-card" id="hb-heat"></section>`;

    el.querySelector('#hb-prev').onclick = () => go(addDays(cur, -1));
    el.querySelector('#hb-next').onclick = () => go(addDays(cur, 1));
    el.querySelector('#hb-today').onclick = () => go(today());
    el.querySelector('#hb-add').onclick = () => openForm();
    el.querySelector('#hb-manage').onclick = openManager;
    el.querySelector('#hb-list').onclick = onListClick;

    await load();
  }
};

function go(d) { cur = d > today() ? today() : d; draw(); }

async function load() {
  const uid = state.viewing.id;
  const [h, l] = await Promise.all([
    sb.from('habits').select('*').eq('user_id', uid).order('urutan').order('created_at'),
    fetchAll(() => sb.from('habit_logs').select('habit_id,tanggal').eq('user_id', uid)
      .gte('tanggal', addDays(today(), -400)).order('tanggal'))
  ]);
  if (!el.isConnected) return;   // halaman sudah ditinggal
  if (h.error) return toast('Gagal memuat habit: ' + h.error.message, 'error');
  habits = h.data;
  logs = new Map();
  (l.data || []).forEach(r => {
    if (!logs.has(r.habit_id)) logs.set(r.habit_id, new Set());
    logs.get(r.habit_id).add(r.tanggal);
  });
  draw();
}

function draw() {
  const ro = state.readOnly;
  el.querySelector('#hb-date').textContent = fmtLong(cur);
  el.querySelector('#hb-title').textContent = ro
    ? `Habit ${state.viewing.display_name} · ${relLabel(cur)}`
    : `Habit ${relLabel(cur)}`;
  el.querySelector('#hb-next').disabled = cur >= today();
  el.querySelector('#hb-today').hidden = cur === today();
  drawSummary();
  drawList();
  drawHeat();
}

function drawSummary() {
  const active = habits.filter(h => h.aktif);
  const { total, done } = summaryFor(logs, active, cur);
  const pct = total ? Math.round(done / total * 100) : 0;
  const best = active.reduce((b, h) => {
    const s = streakOf(logs, h);
    return s > b.s ? { s, h } : b;
  }, { s: 0, h: null });
  const msg = !total ? (active.length ? '🎉 Target mingguan sudah tercapai semua!' : '') :
    pct === 100 ? '🏆 Sempurna! Semua habit beres.' :
    pct >= 60 ? '🔥 Dikit lagi!' : pct > 0 ? '💪 Lanjut terus!' : '🌱 Yuk mulai satu habit.';

  el.querySelector('#hb-summary').innerHTML = `
    <div class="ring" style="--pct:${pct}"><span>${pct}%</span></div>
    <div class="hb-sum-text">
      <b>${done} / ${total}</b> habit ${cur === today() ? 'hari ini' : 'di hari ini'}
      <span class="muted">${msg}</span>
      ${best.h ? `<span class="hb-best">🔥 Streak terpanjang aktif: <b>${best.s} ${unit(best.h)}</b> · ${esc(best.h.icon)} ${esc(best.h.nama)}</span>` : ''}
    </div>`;
}

function drawList() {
  const list = el.querySelector('#hb-list');
  const active = habits.filter(h => h.aktif);
  if (!active.length) {
    list.innerHTML = `
      <div class="card empty hb-empty">
        <div class="empty-icon">${persona().mascot}</div>
        <p>${state.readOnly ? 'Belum ada habit.' : 'Belum ada habit. Mulai dari satu kebiasaan kecil!'}</p>
        <div class="suggest" data-edit>
          ${SUGGEST.slice(0, 6).map((s, i) => `<button class="chip-btn" data-suggest="${i}">${s[1]} ${s[0]}</button>`).join('')}
        </div>
      </div>`;
    list.querySelectorAll('[data-suggest]').forEach(b => b.onclick = () => quickAdd(SUGGEST[b.dataset.suggest]));
    return;
  }

  const ws = weekStart(cur), t = today();
  list.innerHTML = active.map((h, idx) => {
    const done = isDone(logs, h, cur);
    const s = streakOf(logs, h);
    const wc = weekCount(logs, h, ws);
    const freq = h.frekuensi === 'harian' ? 'Setiap hari' : `${wc}/${h.target_per_minggu}× minggu ini`;
    const metWeek = h.frekuensi === 'mingguan' && wc >= h.target_per_minggu;
    return `
      <article class="habit-card ${done ? 'done' : ''} ${metWeek ? 'met' : ''}" data-id="${h.id}" style="--c:${esc(h.warna)};--i:${idx}">
        <button class="hb-check" data-act="toggle" data-date="${cur}" ${state.readOnly ? 'disabled' : ''}
          aria-label="${done ? 'Batal centang' : 'Centang'} ${esc(h.nama)}">
          <span class="hb-icon">${esc(h.icon)}</span><span class="hb-tick">✓</span>
        </button>
        <div class="hb-main">
          <button class="hb-name" data-act="detail">${esc(h.nama)}</button>
          <div class="hb-meta">
            <span class="hb-streak ${s ? 'on' : ''}">🔥 ${s} ${unit(h)}</span>
            <span class="muted">· ${freq}${metWeek ? ' ✓' : ''}</span>
          </div>
          <div class="hb-week">
            ${DOW.map((n, i) => {
              const d = addDays(ws, i);
              const on = isDone(logs, h, d);
              return `<button class="wd ${on ? 'on' : ''} ${d === cur ? 'sel' : ''} ${d === t ? 'today' : ''}"
                data-act="toggle" data-date="${d}" ${d > t || state.readOnly ? 'disabled' : ''}
                title="${fmtShort(d)}">${n}</button>`;
            }).join('')}
          </div>
        </div>
        <button class="icon-btn hb-edit" data-act="edit" data-edit title="Edit">✏️</button>
      </article>`;
  }).join('');
}

function drawHeat() {
  const WEEKS = innerWidth < 700 ? 13 : 20;
  const t = today();
  const start = addDays(weekStart(t), -7 * (WEEKS - 1));
  const active = habits.filter(h => h.aktif);
  const box = el.querySelector('#hb-heat');
  if (!habits.length) { box.innerHTML = ''; return; }

  let totalDone = 0, perfect = 0;
  const cells = [];
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      if (day > t) { cells.push('<i class="hm-cell future"></i>'); continue; }
      const eligible = active.filter(h => h.created_at.slice(0, 10) <= day);
      const due = dueOn(logs, eligible, day);
      const n = due.filter(h => isDone(logs, h, day)).length;
      totalDone += n;
      const ratio = due.length ? n / due.length : 0;
      if (due.length && ratio === 1) perfect++;
      const lvl = !n ? 0 : ratio < .34 ? 1 : ratio < .67 ? 2 : ratio < 1 ? 3 : 4;
      cells.push(`<i class="hm-cell l${lvl} ${day === t ? 'today' : ''}" title="${fmtShort(day)}: ${n}/${due.length} habit"></i>`);
    }
  }
  const months = [];
  let lastLabel = -9;
  for (let w = 0; w < WEEKS; w++) {
    const d = parse(addDays(start, w * 7));
    const prev = w ? parse(addDays(start, (w - 1) * 7)) : null;
    if ((!prev || prev.getMonth() !== d.getMonth()) && w - lastLabel >= 3) {
      months.push(`<span style="grid-column:${w + 1}">${d.toLocaleDateString('id-ID', { month: 'short' })}</span>`);
      lastLabel = w;
    }
  }

  box.innerHTML = `
    <header class="sched-head">
      <h2>📊 Konsistensi <span class="muted small">${WEEKS} minggu terakhir</span></h2>
    </header>
    <div class="hm-wrap">
      <div class="hm-days"><span>Sen</span><span></span><span>Rab</span><span></span><span>Jum</span><span></span><span>Min</span></div>
      <div>
        <div class="hm-months" style="--w:${WEEKS}">${months.join('')}</div>
        <div class="heatmap" style="--w:${WEEKS}">${cells.join('')}</div>
      </div>
    </div>
    <div class="hm-foot">
      <span class="muted small">✅ ${totalDone} check-in · 🌟 ${perfect} hari sempurna</span>
      <span class="hm-legend muted small">Sedikit <i class="hm-cell l0"></i><i class="hm-cell l1"></i><i class="hm-cell l2"></i><i class="hm-cell l3"></i><i class="hm-cell l4"></i> Penuh</span>
    </div>`;
}

// ---------- Aksi ----------
async function onListClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const h = habits.find(x => x.id === b.closest('[data-id]')?.dataset.id);
  if (!h) return;
  if (b.dataset.act === 'detail') return openDetail(h);
  try { assertCanEdit(); } catch (err) { return toast(err.message, 'error'); }
  if (b.dataset.act === 'edit') return openForm(h);
  if (b.dataset.act === 'toggle') return toggle(h, b.dataset.date, b);
}

async function toggle(h, d, btn) {
  if (d > today()) return;
  if (!logs.has(h.id)) logs.set(h.id, new Set());
  const set = logs.get(h.id);
  const wasDone = set.has(d);
  wasDone ? set.delete(d) : set.add(d);
  draw();

  if (!wasDone) {
    const r = btn.getBoundingClientRect();
    const s = streakOf(logs, h);
    const { total, done } = summaryFor(logs, habits.filter(x => x.aktif), cur);
    if (d === cur && total && done === total) {
      celebrate(r.left + r.width / 2, r.top);
      setTimeout(() => sticker('🏆 SEMUA HABIT BERES!'), 700);
    } else if (MILESTONES.includes(s) && (h.frekuensi !== 'harian' || d === today())) {
      celebrate(r.left + r.width / 2, r.top);
      setTimeout(() => sticker(`🔥 ${s} ${unit(h)} beruntun!`), 600);
    } else {
      sticker(null, r.left + r.width / 2 + 60, r.top - 10);
    }
  }

  const q = wasDone
    ? sb.from('habit_logs').delete().eq('habit_id', h.id).eq('tanggal', d)
    : sb.from('habit_logs').insert({ habit_id: h.id, tanggal: d });
  const { error } = await q;
  if (error) {
    wasDone ? set.add(d) : set.delete(d);
    draw();
    toast('Gagal menyimpan: ' + error.message, 'error');
  }
}

async function quickAdd([nama, icon, frekuensi, target]) {
  try { assertCanEdit(); } catch (err) { return toast(err.message, 'error'); }
  const row = { nama, icon, frekuensi, target_per_minggu: target, warna: COLORS[habits.length % COLORS.length], urutan: habits.length };
  const { data, error } = await sb.from('habits').insert(row).select().single();
  if (error) return toast(error.message, 'error');
  habits.push(data);
  sticker('🌱 Habit baru!');
  draw();
}

// ---------- Form tambah / edit ----------
function openForm(h = null) {
  try { assertCanEdit(); } catch (err) { return toast(err.message, 'error'); }
  const m = modal({ title: h ? '✏️ Edit Habit' : '🌱 Habit Baru' });
  const mingguan = h?.frekuensi === 'mingguan';
  m.body.innerHTML = `
    <form class="sched-form" autocomplete="off">
      ${h ? '' : `
        <div class="field">
          <span class="field-label">Ide cepat</span>
          <div class="suggest">${SUGGEST.map((s, i) => `<button type="button" class="chip-btn" data-s="${i}">${s[1]} ${s[0]}</button>`).join('')}</div>
        </div>`}
      <label>Nama habit<input name="nama" required maxlength="60" placeholder="Contoh: Baca buku 20 menit" value="${esc(h?.nama || '')}"></label>
      <div class="field">
        <span class="field-label">Frekuensi</span>
        <div class="seg" id="hf-freq">
          <button type="button" data-f="harian" class="${mingguan ? '' : 'active'}">Setiap hari</button>
          <button type="button" data-f="mingguan" class="${mingguan ? 'active' : ''}">Beberapa kali / minggu</button>
        </div>
        <div class="hf-target" ${mingguan ? '' : 'hidden'}>
          Target <select name="target">${[1, 2, 3, 4, 5, 6].map(n =>
            `<option value="${n}" ${(h?.target_per_minggu || 3) === n ? 'selected' : ''}>${n}×</option>`).join('')}</select> per minggu
        </div>
      </div>
      <div class="field">
        <span class="field-label">Ikon</span>
        <div class="chips icons">${ICONS.map(ic => `<label class="chip"><input type="radio" name="icon" value="${ic}" ${(h?.icon || '✅') === ic ? 'checked' : ''}><span>${ic}</span></label>`).join('')}</div>
      </div>
      <div class="field">
        <span class="field-label">Warna</span>
        <div class="chips colors">${COLORS.map((c, i) => `<label class="chip color"><input type="radio" name="warna" value="${c}" ${(h?.warna || COLORS[habits.length % COLORS.length]) === c ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div>
      </div>
      <div class="form-actions">
        <button class="btn" type="submit">${h ? '💾 Simpan' : '＋ Tambah habit'}</button>
        ${h ? `
          <button class="btn btn-ghost" type="button" data-act="pause">⏸️ Jeda</button>
          <button class="btn btn-ghost danger-text" type="button" data-act="del">🗑️ Hapus</button>` : ''}
      </div>
      ${h ? '<p class="muted small">Jeda = habit disembunyikan sementara, riwayat tetap aman. Hapus = habit & seluruh riwayatnya hilang.</p>' : ''}
    </form>`;

  const f = m.body.querySelector('form');
  let freq = mingguan ? 'mingguan' : 'harian';
  const setFreq = v => {
    freq = v;
    f.querySelectorAll('[data-f]').forEach(b => b.classList.toggle('active', b.dataset.f === v));
    f.querySelector('.hf-target').hidden = v !== 'mingguan';
  };
  f.querySelectorAll('[data-f]').forEach(b => b.onclick = () => setFreq(b.dataset.f));
  f.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
    const [nama, icon, fr, tg] = SUGGEST[b.dataset.s];
    f.nama.value = nama;
    f.querySelector(`[name=icon][value="${icon}"]`).checked = true;
    setFreq(fr);
    if (fr === 'mingguan') f.target.value = tg;
  });

  f.onsubmit = async e => {
    e.preventDefault();
    const row = {
      nama: f.nama.value.trim(), icon: f.icon.value, warna: f.warna.value, frekuensi: freq,
      target_per_minggu: freq === 'harian' ? 7 : Number(f.target.value)
    };
    if (!h) row.urutan = habits.length;
    const q = h ? sb.from('habits').update(row).eq('id', h.id).select().single()
                : sb.from('habits').insert(row).select().single();
    const { data, error } = await q;
    if (error) return toast('Gagal menyimpan: ' + error.message, 'error');
    if (h) Object.assign(h, data); else habits.push(data);
    m.close();
    if (!h) sticker('🌱 Habit baru!');
    draw();
  };

  f.querySelector('[data-act=pause]')?.addEventListener('click', async () => {
    const { error } = await sb.from('habits').update({ aktif: false }).eq('id', h.id);
    if (error) return toast(error.message, 'error');
    h.aktif = false;
    m.close();
    toast(`"${h.nama}" dijeda — aktifkan lagi lewat ⚙️ Kelola`);
    draw();
  });
  f.querySelector('[data-act=del]')?.addEventListener('click', async ev => {
    const b = ev.currentTarget;
    if (b.dataset.confirm !== '1') {
      b.dataset.confirm = '1';
      b.textContent = `Yakin? ${logs.get(h.id)?.size || 0} riwayat ikut terhapus`;
      return;
    }
    const { error } = await sb.from('habits').delete().eq('id', h.id);
    if (error) return toast(error.message, 'error');
    habits = habits.filter(x => x !== h);
    logs.delete(h.id);
    m.close();
    toast('Habit dihapus');
    draw();
  });
}

// ---------- Kelola: urutan & jeda ----------
function openManager() {
  try { assertCanEdit(); } catch (err) { return toast(err.message, 'error'); }
  const m = modal({ title: '⚙️ Kelola Habit', onClose: draw });

  const render = () => {
    m.body.innerHTML = habits.length ? `
      <p class="muted small">Atur urutan tampil dengan ↑ ↓. Habit yang dijeda tidak muncul di daftar harian.</p>
      <ul class="sched-list">
        ${habits.map((h, i) => `
          <li class="${h.aktif ? '' : 'paused'}" data-id="${h.id}" style="--c:${esc(h.warna)}">
            <span class="sl-icon">${esc(h.icon)}</span>
            <span class="sl-body"><b>${esc(h.nama)}</b>
              <small class="muted">${h.frekuensi === 'harian' ? 'Setiap hari' : h.target_per_minggu + '× / minggu'} · 🔥 ${streakOf(logs, h)} ${unit(h)}${h.aktif ? '' : ' · dijeda'}</small></span>
            <span class="sl-actions">
              <button class="icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} title="Naik">↑</button>
              <button class="icon-btn" data-act="down" ${i === habits.length - 1 ? 'disabled' : ''} title="Turun">↓</button>
              <button class="icon-btn" data-act="pause" title="${h.aktif ? 'Jeda' : 'Aktifkan'}">${h.aktif ? '⏸️' : '▶️'}</button>
              <button class="icon-btn" data-act="edit" title="Edit">✏️</button>
            </span>
          </li>`).join('')}
      </ul>` : '<p class="muted">Belum ada habit.</p>';

    m.body.querySelector('.sched-list')?.addEventListener('click', async e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const i = habits.findIndex(x => x.id === b.closest('[data-id]').dataset.id);
      const h = habits[i];
      if (b.dataset.act === 'edit') { m.close(); return openForm(h); }
      if (b.dataset.act === 'pause') {
        const aktif = !h.aktif;
        const { error } = await sb.from('habits').update({ aktif }).eq('id', h.id);
        if (error) return toast(error.message, 'error');
        h.aktif = aktif; return render();
      }
      const j = b.dataset.act === 'up' ? i - 1 : i + 1;
      [habits[i], habits[j]] = [habits[j], habits[i]];
      render();
      // Simpan urutan baru untuk baris yang berubah
      const changed = habits.map((x, k) => ({ x, k })).filter(({ x, k }) => x.urutan !== k);
      changed.forEach(({ x, k }) => x.urutan = k);
      const res = await Promise.all(changed.map(({ x, k }) => sb.from('habits').update({ urutan: k }).eq('id', x.id)));
      if (res.some(r => r.error)) toast('Gagal menyimpan urutan', 'error');
    });
  };
  render();
}

// ---------- Detail & statistik per habit ----------
function openDetail(h) {
  const t = today();
  const set = logs.get(h.id) || new Set();
  const s = streakOf(logs, h), best = longestOf(h);
  const since = h.created_at.slice(0, 10);
  const days30 = Array.from({ length: 30 }, (_, i) => addDays(t, -i)).filter(d => d >= since);
  const rate = h.frekuensi === 'harian'
    ? (days30.length ? Math.round(days30.filter(d => set.has(d)).length / days30.length * 100) : 0)
    : (() => {
        const wks = [0, 1, 2, 3].map(k => addDays(weekStart(t), -7 * k)).filter(ws => addDays(ws, 6) >= since);
        return wks.length ? Math.round(wks.filter(ws => weekCount(logs, h, ws) >= h.target_per_minggu).length / wks.length * 100) : 0;
      })();

  const WEEKS = 26;
  const start = addDays(weekStart(t), -7 * (WEEKS - 1));
  const cells = Array.from({ length: WEEKS * 7 }, (_, i) => {
    const d = addDays(start, i);
    if (d > t) return '<i class="hm-cell future"></i>';
    return `<i class="hm-cell ${set.has(d) ? 'l4' : 'l0'}" title="${fmtShort(d)}"></i>`;
  }).join('');

  const m = modal({ title: `${h.icon} ${h.nama}` });
  m.body.innerHTML = `
    <div class="stat-grid" style="--c:${esc(h.warna)}">
      <div class="stat"><b>🔥 ${s}</b><span>Streak sekarang (${unit(h)})</span></div>
      <div class="stat"><b>🏆 ${best}</b><span>Streak terbaik (${unit(h)})</span></div>
      <div class="stat"><b>✅ ${set.size}</b><span>Total check-in</span></div>
      <div class="stat"><b>${rate}%</b><span>${h.frekuensi === 'harian' ? 'Konsistensi 30 hari' : 'Target tercapai 4 minggu'}</span></div>
    </div>
    <p class="muted small">${h.frekuensi === 'harian' ? 'Setiap hari' : `Target ${h.target_per_minggu}× per minggu`} · dimulai ${fmtShort(since)}</p>
    <div class="heatmap single" style="--w:${WEEKS};--c:${esc(h.warna)}">${cells}</div>
    <div class="form-actions" style="margin-top:16px" data-edit>
      <button class="btn btn-ghost" data-act="edit">✏️ Edit habit</button>
    </div>`;
  m.body.querySelector('[data-act=edit]').onclick = () => { m.close(); openForm(h); };
}
