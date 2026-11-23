import { sb } from '../supabase.js';
import { state, assertCanEdit } from '../state.js';
import { toast, esc } from '../ui.js';
import { sticker, celebrate, persona } from '../fx.js';
import { createSchedule } from './todo-schedule.js';
import { today, addDays, weekStart, relLabel, fmtLong, fmtShort, dayName, parse } from '../date.js';

const PRI = {
  1: { label: 'Penting', icon: '🔥' },
  2: { label: 'Normal',  icon: '•' },
  3: { label: 'Santai',  icon: '☁️' }
};

let cur = today();      // tanggal yang sedang dilihat (bertahan antar navigasi)
let el, sched, items = [], overdue = [], week = [];

export default {
  async render(root) {
    el = root;
    el.innerHTML = `
      <header class="page-head">
        <div>
          <p class="eyebrow" id="td-date"></p>
          <h1 class="page-title" id="td-title">To-do</h1>
        </div>
        <div class="date-nav">
          <button class="icon-btn" id="td-prev" aria-label="Hari sebelumnya">‹</button>
          <label class="date-pick" title="Pilih tanggal">📅<input type="date" id="td-pick" data-allow-ro></label>
          <button class="icon-btn" id="td-next" aria-label="Hari berikutnya">›</button>
          <button class="btn btn-ghost btn-sm" id="td-today">Hari ini</button>
        </div>
      </header>

      <div class="week-strip" id="td-week"></div>

      <section class="card td-summary">
        <div class="td-summary-top">
          <span id="td-count">0 / 0 selesai</span>
          <span class="muted small" id="td-msg"></span>
        </div>
        <div class="progress"><i id="td-bar"></i></div>
      </section>

      <div id="td-sched"></div>

      <form class="card td-add" id="td-form" data-edit autocomplete="off">
        <input name="no" class="td-no-in" type="number" min="1" max="99" inputmode="numeric" placeholder="No." title="Nomor urutan (opsional)">
        <input name="judul" placeholder="Tambah tugas… (Enter)" maxlength="200" required>
        <div class="pri-pick" role="radiogroup" aria-label="Prioritas">
          ${[1, 2, 3].map(p => `
            <label class="pri-opt pri-${p}"><input type="radio" name="pri" value="${p}" ${p === 2 ? 'checked' : ''}>
              <span>${PRI[p].icon} ${PRI[p].label}</span></label>`).join('')}
        </div>
        <button class="btn" type="submit">＋ Tambah</button>
      </form>

      <section id="td-overdue"></section>
      <div class="td-tools" id="td-tools" data-edit></div>
      <ul class="todo-list" id="td-list"></ul>

      <div id="td-grid"></div>`;

    el.querySelector('#td-prev').onclick = () => go(addDays(cur, -1));
    el.querySelector('#td-next').onclick = () => go(addDays(cur, 1));
    el.querySelector('#td-today').onclick = () => go(today());
    el.querySelector('#td-pick').onchange = e => e.target.value && go(e.target.value);
    el.querySelector('#td-form').onsubmit = onAdd;
    el.querySelector('#td-list').onclick = onListClick;
    el.querySelector('#td-overdue').onclick = onOverdueClick;
    sched = createSchedule(el.querySelector('#td-sched'), {
      gridContainer: el.querySelector('#td-grid'),
      onChange: () => drawWeek()
    });

    await load();
  }
};

function go(d) { cur = d; load(); }

// ---------- Data ----------
async function load() {
  const uid = state.viewing.id;
  const t = today();
  const ws = weekStart(cur);

  const [a, b, c] = await Promise.all([
    sb.from('todos').select('*').eq('user_id', uid).eq('tanggal', cur)
      .order('done').order('prioritas').order('created_at'),
    cur === t
      ? sb.from('todos').select('*').eq('user_id', uid).lt('tanggal', t).eq('done', false)
          .order('tanggal').order('prioritas')
      : Promise.resolve({ data: [] }),
    sb.from('todos').select('tanggal,done').eq('user_id', uid)
      .gte('tanggal', ws).lte('tanggal', addDays(ws, 6)),
    sched.load(cur)
  ]);
  if (!el.isConnected) return;   // halaman sudah ditinggal
  if (a.error) return toast('Gagal memuat: ' + a.error.message, 'error');

  items = a.data;
  overdue = b.data || [];
  week = c.data || [];
  draw();
}

// ---------- Tampilan ----------
function draw() {
  const ro = state.readOnly;
  el.querySelector('#td-date').textContent = fmtLong(cur);
  el.querySelector('#td-title').textContent = ro
    ? `To-do ${state.viewing.display_name} · ${relLabel(cur)}`
    : `To-do ${relLabel(cur)}`;
  el.querySelector('#td-pick').value = cur;
  el.querySelector('#td-today').hidden = cur === today();

  drawWeek();
  drawSummary();
  drawOverdue();

  sortItems();
  drawTools();
  const list = el.querySelector('#td-list');
  list.innerHTML = items.length
    ? items.map(itemHtml).join('')
    : `<li class="card empty todo-empty">
         <div class="empty-icon">${persona().mascot}</div>
         <p>${ro ? 'Belum ada tugas di hari ini.' : 'Belum ada tugas. Tulis satu hal kecil yang mau kamu selesaikan!'}</p>
       </li>`;
}

function sortItems() {
  const no = t => t.urutan || 999;
  items.sort((x, y) => (x.done - y.done) || (no(x) - no(y)) || (x.prioritas - y.prioritas) ||
    (x.created_at < y.created_at ? -1 : 1));
}

function itemHtml(t) {
  return `
    <li class="todo-item pri-${t.prioritas} ${t.done ? 'done' : ''}" data-id="${t.id}">
      <button class="todo-check" data-act="toggle" ${state.readOnly ? 'disabled' : ''}
        aria-label="${t.done ? 'Tandai belum selesai' : 'Tandai selesai'}"><span>✓</span></button>
      <button class="todo-no ${t.urutan && !t.done ? 'set' : ''}" data-act="no" ${state.readOnly || t.done ? 'disabled' : ''}
        title="${t.done ? '' : t.urutan ? 'Urutan ke-' + t.urutan + ' — klik untuk ubah' : 'Beri nomor urutan'}">${t.urutan && !t.done ? t.urutan : '#'}</button>
      <span class="todo-title">${esc(t.judul)}</span>
      <button class="todo-pri" data-act="pri" ${state.readOnly ? 'disabled' : ''} title="Ganti prioritas">
        ${PRI[t.prioritas].icon} ${PRI[t.prioritas].label}</button>
      <div class="todo-actions" data-edit>
        <button class="icon-btn" data-act="edit" title="Edit">✏️</button>
        <button class="icon-btn" data-act="move" title="Pindah ke besok">⏭️</button>
        <button class="icon-btn" data-act="del" title="Hapus">🗑️</button>
      </div>
    </li>`;
}

function drawWeek() {
  const ws = weekStart(cur);
  const t = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  el.querySelector('#td-week').innerHTML = days.map(d => {
    const rows = week.filter(w => w.tanggal === d);
    const total = rows.length, done = rows.filter(r => r.done).length;
    const pct = total ? Math.round(done / total * 100) : 0;
    const st = !total ? 'none' : done === total ? 'full' : 'part';
    const nSched = sched.countFor(d);
    return `
      <button class="day ${d === cur ? 'active' : ''} ${d === t ? 'is-today' : ''} ${nSched ? 'has-sched' : ''}" data-day="${d}"
        style="--pct:${pct}" title="${total} tugas${nSched ? ` · ${nSched} jadwal rutin` : ''}">
        <span class="day-name">${dayName(d)}</span>
        <span class="day-num">${parse(d).getDate()}</span>
        <span class="day-dot ${st}">${st === 'full' ? '✓' : total ? `${done}/${total}` : ''}</span>
      </button>`;
  }).join('');
  el.querySelectorAll('[data-day]').forEach(b => b.onclick = () => go(b.dataset.day));
}

function drawSummary() {
  const total = items.length, done = items.filter(i => i.done).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  el.querySelector('#td-count').innerHTML = `<b>${done}</b> / ${total} selesai`;
  el.querySelector('#td-bar').style.width = pct + '%';
  const msg = !total ? '' :
    pct === 100 ? '🏆 Semua beres!' :
    pct >= 70 ? '🔥 Dikit lagi!' :
    pct >= 30 ? '💪 Lanjutkan!' : '🚀 Ayo mulai!';
  el.querySelector('#td-msg').textContent = msg;
}

function drawOverdue() {
  const box = el.querySelector('#td-overdue');
  if (!overdue.length) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <details class="card overdue" open>
      <summary>
        <span>⏳ Tertunda dari hari sebelumnya <b>(${overdue.length})</b></span>
        <button class="btn btn-sm" data-act="move-all" data-edit>Pindahkan semua ke hari ini</button>
      </summary>
      <ul>
        ${overdue.map(t => `
          <li data-id="${t.id}">
            <span class="od-date">${fmtShort(t.tanggal)}</span>
            <span class="od-title">${PRI[t.prioritas].icon} ${esc(t.judul)}</span>
            <span class="od-actions" data-edit>
              <button class="btn btn-ghost btn-sm" data-act="od-move">Hari ini</button>
              <button class="icon-btn" data-act="od-done" title="Tandai selesai">✓</button>
            </span>
          </li>`).join('')}
      </ul>
    </details>`;
}

// ---------- Aksi ----------
async function onAdd(e) {
  e.preventDefault();
  try { assertCanEdit(); } catch (err) { return toast(err.message, 'error'); }
  const f = e.target;
  const judul = f.judul.value.trim();
  if (!judul) return;
  const prioritas = Number(f.pri.value);
  const urutan = Math.min(99, Math.max(0, parseInt(f.no.value) || 0)) || null;
  f.judul.value = '';
  f.no.value = '';
  f.judul.focus();

  const row = { judul, prioritas, tanggal: cur };
  if (urutan) { row.urutan = urutan; await makeRoom(urutan, null); }
  const { data, error } = await sb.from('todos').insert(row).select().single();
  if (error) { f.judul.value = judul; return toast('Gagal menambah: ' + noHint(error.message), 'error'); }
  items.push(data);
  week.push({ tanggal: cur, done: false });
  draw();
  el.querySelector(`[data-id="${data.id}"]`)?.classList.add('pop-in');
}

async function onListClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const li = btn.closest('.todo-item');
  const t = items.find(i => i.id === li?.dataset.id);
  if (!t) return;
  try { assertCanEdit(); } catch (err) { return toast(err.message, 'error'); }

  switch (btn.dataset.act) {
    case 'toggle': return toggle(t, btn);
    case 'pri':    return update(t, { prioritas: t.prioritas % 3 + 1 });
    case 'no':     return editNumber(t, btn);
    case 'edit':   return startEdit(t, li);
    case 'move':   return moveTo(t, addDays(cur, 1), 'Dipindah ke besok ⏭️');
    case 'del':    return remove(t);
  }
}

async function toggle(t, btn) {
  const done = !t.done;
  const patch = { done, done_at: done ? new Date().toISOString() : null };
  Object.assign(t, patch);
  syncWeek(t.tanggal);
  draw();

  if (done) {
    const r = btn.getBoundingClientRect();
    const allDone = items.length > 0 && items.every(i => i.done);
    allDone
      ? celebrate(r.left + r.width / 2, r.top)
      : sticker(null, r.left + 120, r.top - 10);
    if (allDone) setTimeout(() => sticker('🏆 SEMUA BERES!'), 700);
  }

  const { error } = await sb.from('todos').update(patch).eq('id', t.id);
  if (error) {
    Object.assign(t, { done: !done, done_at: null });
    syncWeek(t.tanggal); draw();
    toast('Gagal menyimpan: ' + error.message, 'error');
  }
}

async function update(t, patch) {
  const old = { ...t };
  Object.assign(t, patch);
  draw();
  const { error } = await sb.from('todos').update(patch).eq('id', t.id);
  if (error) { Object.assign(t, old); draw(); toast('Gagal menyimpan: ' + error.message, 'error'); }
}

function startEdit(t, li) {
  const span = li.querySelector('.todo-title');
  const input = document.createElement('input');
  input.className = 'todo-edit';
  input.value = t.judul;
  input.maxLength = 200;
  span.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (save && v && v !== t.judul) update(t, { judul: v });
    else draw();
  };
  input.onkeydown = e => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  };
  input.onblur = () => finish(true);
}

async function moveTo(t, tanggal, msg) {
  const { error } = await sb.from('todos').update({ tanggal, ...('urutan' in t ? { urutan: null } : {}) }).eq('id', t.id);
  if (error) return toast('Gagal memindah: ' + error.message, 'error');
  toast(msg);
  load();
}

function remove(t) {
  // Hapus dulu dari tampilan, beri kesempatan "Batal" 4 detik sebelum benar-benar dihapus
  const idx = items.indexOf(t);
  items.splice(idx, 1);
  syncWeek(t.tanggal); draw();
  let undone = false;
  toast('Tugas dihapus', 'ok', {
    action: 'Batal', duration: 4000,
    onAction: () => { undone = true; items.splice(idx, 0, t); syncWeek(t.tanggal); draw(); }
  });
  setTimeout(async () => {
    if (undone) return;
    const { error } = await sb.from('todos').delete().eq('id', t.id);
    if (error) { items.splice(idx, 0, t); syncWeek(t.tanggal); draw(); toast('Gagal menghapus: ' + error.message, 'error'); }
  }, 4100);
}

async function onOverdueClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  e.preventDefault();
  try { assertCanEdit(); } catch (err) { return toast(err.message, 'error'); }
  const t0 = today();

  if (btn.dataset.act === 'move-all') {
    const ids = overdue.map(o => o.id);
    const { error } = await sb.from('todos').update({ tanggal: t0 }).in('id', ids);
    if (error) return toast('Gagal memindah: ' + error.message, 'error');
    sticker(`📥 ${ids.length} tugas dipindah`);
    return load();
  }

  const id = btn.closest('li')?.dataset.id;
  if (btn.dataset.act === 'od-move') {
    const { error } = await sb.from('todos').update({ tanggal: t0 }).eq('id', id);
    if (error) return toast(error.message, 'error');
    return load();
  }
  if (btn.dataset.act === 'od-done') {
    const { error } = await sb.from('todos')
      .update({ done: true, done_at: new Date().toISOString() }).eq('id', id);
    if (error) return toast(error.message, 'error');
    const r = btn.getBoundingClientRect();
    sticker(null, r.left, r.top - 10);
    return load();
  }
}

// Perbarui cache minggu tanpa query ulang
function syncWeek(tanggal) {
  week = week.filter(w => w.tanggal !== tanggal)
    .concat(items.filter(i => i.tanggal === tanggal).map(i => ({ tanggal, done: i.done })));
}

// ---------- Nomor urutan pengerjaan ----------
const noHint = msg => /urutan|schema cache|column/i.test(msg) ? 'jalankan dulu 10_todo_urutan.sql di Supabase' : msg;

function drawTools() {
  const box = el.querySelector('#td-tools');
  const open = items.filter(i => !i.done);
  const numbered = open.filter(i => i.urutan).length;
  box.innerHTML = open.length > 1 ? `
    <button class="link-btn" data-tool="auto">🔢 Beri nomor otomatis (${open.length} tugas)</button>
    ${numbered ? '<button class="link-btn" data-tool="clear">Hapus semua nomor</button>' : ''}
    <span class="muted small">Tip: klik kotak <b>#</b> di tugas untuk memberi nomor urutan pengerjaan.</span>` : '';
  box.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => b.dataset.tool === 'auto' ? autoNumber() : clearNumbers());
}

// Kalau nomor n sudah dipakai, geser tugas bernomor ≥ n satu langkah ke bawah
async function makeRoom(n, exceptId) {
  const taken = items.some(i => !i.done && i.id !== exceptId && i.urutan === n);
  if (!taken) return;
  const shift = items.filter(i => !i.done && i.id !== exceptId && i.urutan >= n).sort((a, b) => b.urutan - a.urutan);
  for (const i of shift) {
    const v = Math.min(99, i.urutan + 1);
    const { error } = await sb.from('todos').update({ urutan: v }).eq('id', i.id);
    if (!error) i.urutan = v;
  }
}

function editNumber(t, btn) {
  const input = document.createElement('input');
  input.type = 'number'; input.min = 1; input.max = 99; input.className = 'todo-no-edit';
  input.value = t.urutan || (Math.max(0, ...items.filter(i => !i.done && i.urutan).map(i => i.urutan)) + 1);
  btn.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const finish = async save => {
    if (done) return; done = true;
    if (!save) return draw();
    const n = Math.min(99, Math.max(0, parseInt(input.value) || 0)) || null;
    if (n === (t.urutan || null)) return draw();
    if (n) await makeRoom(n, t.id);
    const { error } = await sb.from('todos').update({ urutan: n }).eq('id', t.id);
    if (error) { draw(); return toast('Gagal menyimpan nomor: ' + noHint(error.message), 'error'); }
    t.urutan = n;
    draw();
    el.querySelector(`[data-id="${t.id}"]`)?.classList.add('pop-in');
  };
  input.onkeydown = e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
  input.onblur = () => finish(true);
}

async function autoNumber() {
  try { assertCanEdit(); } catch (err) { return toast(err.message, 'error'); }
  const open = items.filter(i => !i.done);      // urutan tampilan sekarang: bernomor → prioritas
  const res = await Promise.all(open.map((i, k) => sb.from('todos').update({ urutan: k + 1 }).eq('id', i.id)));
  const err = res.find(r => r.error);
  if (err) return toast('Gagal memberi nomor: ' + noHint(err.error.message), 'error');
  open.forEach((i, k) => i.urutan = k + 1);
  draw(); sticker('🔢 Urutan siap!');
}

async function clearNumbers() {
  try { assertCanEdit(); } catch (err) { return toast(err.message, 'error'); }
  const ids = items.filter(i => i.urutan).map(i => i.id);
  const { error } = await sb.from('todos').update({ urutan: null }).in('id', ids);
  if (error) return toast(error.message, 'error');
  items.forEach(i => i.urutan = null);
  draw();
}
