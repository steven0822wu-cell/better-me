import { sb } from '../supabase.js';
import { state, assertCanEdit } from '../state.js';
import { toast, esc } from '../ui.js';
import { sticker, celebrate, persona } from '../fx.js';
import { today, addDays, weekStart, relLabel, fmtLong, fmtShort, dayName, parse } from '../date.js';

const PRI = {
  1: { label: 'Penting', icon: '🔥' },
  2: { label: 'Normal',  icon: '•' },
  3: { label: 'Santai',  icon: '☁️' }
};

let cur = today();      // tanggal yang sedang dilihat (bertahan antar navigasi)
let el, items = [], overdue = [], week = [];

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

      <form class="card td-add" id="td-form" data-edit autocomplete="off">
        <input name="judul" placeholder="Tambah tugas… (Enter)" maxlength="200" required>
        <div class="pri-pick" role="radiogroup" aria-label="Prioritas">
          ${[1, 2, 3].map(p => `
            <label class="pri-opt pri-${p}"><input type="radio" name="pri" value="${p}" ${p === 2 ? 'checked' : ''}>
              <span>${PRI[p].icon} ${PRI[p].label}</span></label>`).join('')}
        </div>
        <button class="btn" type="submit">＋ Tambah</button>
      </form>

      <section id="td-overdue"></section>
      <ul class="todo-list" id="td-list"></ul>`;

    el.querySelector('#td-prev').onclick = () => go(addDays(cur, -1));
    el.querySelector('#td-next').onclick = () => go(addDays(cur, 1));
    el.querySelector('#td-today').onclick = () => go(today());
    el.querySelector('#td-pick').onchange = e => e.target.value && go(e.target.value);
    el.querySelector('#td-form').onsubmit = onAdd;
    el.querySelector('#td-list').onclick = onListClick;
    el.querySelector('#td-overdue').onclick = onOverdueClick;

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
      .gte('tanggal', ws).lte('tanggal', addDays(ws, 6))
  ]);
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
  const list = el.querySelector('#td-list');
  list.innerHTML = items.length
    ? items.map(itemHtml).join('')
    : `<li class="card empty todo-empty">
         <div class="empty-icon">${persona().mascot}</div>
         <p>${ro ? 'Belum ada tugas di hari ini.' : 'Belum ada tugas. Tulis satu hal kecil yang mau kamu selesaikan!'}</p>
       </li>`;
}

function sortItems() {
  items.sort((x, y) => (x.done - y.done) || (x.prioritas - y.prioritas) ||
    (x.created_at < y.created_at ? -1 : 1));
}

function itemHtml(t) {
  return `
    <li class="todo-item pri-${t.prioritas} ${t.done ? 'done' : ''}" data-id="${t.id}">
      <button class="todo-check" data-act="toggle" ${state.readOnly ? 'disabled' : ''}
        aria-label="${t.done ? 'Tandai belum selesai' : 'Tandai selesai'}"><span>✓</span></button>
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
    return `
      <button class="day ${d === cur ? 'active' : ''} ${d === t ? 'is-today' : ''}" data-day="${d}" style="--pct:${pct}">
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
  f.judul.value = '';
  f.judul.focus();

  const { data, error } = await sb.from('todos')
    .insert({ judul, prioritas, tanggal: cur }).select().single();
  if (error) { f.judul.value = judul; return toast('Gagal menambah: ' + error.message, 'error'); }
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
  const { error } = await sb.from('todos').update({ tanggal }).eq('id', t.id);
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
