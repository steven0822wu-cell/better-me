import { sb } from '../supabase.js';
import { state, assertCanEdit } from '../state.js';
import { toast, esc, modal } from '../ui.js';
import { sticker, celebrate, persona } from '../fx.js';
import { fetchAll } from '../db.js';
import { today, addDays, weekStart, relLabel, fmtShort, parse, ymd } from '../date.js';

export const JENIS = [
  { id: 'Gym',       icon: '🏋️', mode: 'strength' },
  { id: 'Lari',      icon: '🏃', mode: 'cardio' },
  { id: 'Jalan',     icon: '🚶', mode: 'cardio' },
  { id: 'Sepeda',    icon: '🚴', mode: 'cardio' },
  { id: 'Renang',    icon: '🏊', mode: 'cardio' },
  { id: 'Badminton', icon: '🏸', mode: 'sport' },
  { id: 'Futsal',    icon: '⚽', mode: 'sport' },
  { id: 'Basket',    icon: '🏀', mode: 'sport' },
  { id: 'Yoga',      icon: '🧘', mode: 'sport' },
  { id: 'Lainnya',   icon: '💪', mode: 'sport' }
];
export const jenisOf = j => JENIS.find(x => x.id === j) || { id: j, icon: '💪', mode: 'sport' };

const COMMON = [
  'Bench Press', 'Incline Bench Press', 'Dumbbell Press', 'Chest Fly', 'Push Up',
  'Squat', 'Leg Press', 'Lunges', 'Leg Extension', 'Leg Curl', 'Calf Raise', 'Romanian Deadlift',
  'Deadlift', 'Pull Up', 'Lat Pulldown', 'Seated Row', 'Barbell Row', 'Dumbbell Row',
  'Shoulder Press', 'Lateral Raise', 'Rear Delt Fly', 'Bicep Curl', 'Hammer Curl',
  'Tricep Pushdown', 'Skull Crusher', 'Dips', 'Plank', 'Crunch', 'Hanging Leg Raise'
];

let el, workouts = [], sets = new Map(); // workout_id → [sets]
let calMonth = today().slice(0, 7);

// ---------- Hitungan ----------
const norm = s => s.trim().toLowerCase();
const volumeOf = list => list.reduce((v, s) => v + (s.reps || 0) * (Number(s.beban_kg) || 0), 0);
const distOf = list => list.reduce((v, s) => v + (Number(s.jarak_km) || 0), 0);
const fmtKg = n => n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + ' ton' : Math.round(n) + ' kg';
const fmtNum = n => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 });

// Rekor per latihan: beban terberat (kalau sama, reps terbanyak)
function prMap(excludeId) {
  const map = new Map();
  for (const w of workouts) {
    if (w.id === excludeId) continue;
    for (const s of sets.get(w.id) || []) {
      const kg = Number(s.beban_kg) || 0;
      if (!kg) continue;
      const k = norm(s.exercise), cur = map.get(k);
      if (!cur || kg > cur.kg || (kg === cur.kg && s.reps > cur.reps))
        map.set(k, { name: s.exercise, kg, reps: s.reps, date: w.tanggal });
    }
  }
  return map;
}

// Minggu berturut-turut yang ada latihannya
function weekStreak() {
  const weeks = new Set(workouts.map(w => weekStart(w.tanggal)));
  let ws = weekStart(today()), n = 0;
  if (!weeks.has(ws)) ws = addDays(ws, -7);
  while (weeks.has(ws)) { n++; ws = addDays(ws, -7); }
  return n;
}

// ---------- Halaman ----------
export default {
  async render(root) {
    el = root;
    el.innerHTML = `
      <header class="page-head">
        <div>
          <p class="eyebrow">Gym & Sport</p>
          <h1 class="page-title" id="gy-title">Latihan</h1>
        </div>
        <button class="btn" id="gy-add" data-edit>＋ Catat latihan</button>
      </header>
      <div class="grid gy-stats" id="gy-stats"></div>
      <div class="gy-cols">
        <section class="card" id="gy-cal"></section>
        <section class="card" id="gy-pr"></section>
      </div>
      <section id="gy-list"></section>`;
    el.querySelector('#gy-add').onclick = () => openForm();
    el.querySelector('#gy-list').onclick = e => {
      const c = e.target.closest('[data-wid]');
      if (c) openDetail(workouts.find(w => w.id === c.dataset.wid));
    };
    await load();
  }
};

async function load() {
  const uid = state.viewing.id;
  const [w, s] = await Promise.all([
    fetchAll(() => sb.from('workouts').select('*').eq('user_id', uid).order('tanggal', { ascending: false }).order('created_at', { ascending: false })),
    fetchAll(() => sb.from('workout_sets').select('*').eq('user_id', uid).order('set_ke'))
  ]);
  if (w.error) return toast('Gagal memuat latihan: ' + w.error.message, 'error');
  workouts = w.data;
  sets = new Map();
  (s.data || []).forEach(x => { if (!sets.has(x.workout_id)) sets.set(x.workout_id, []); sets.get(x.workout_id).push(x); });
  draw();
}

function draw() {
  el.querySelector('#gy-title').textContent = state.readOnly ? `Latihan ${state.viewing.display_name}` : 'Latihan';
  drawStats(); drawCal(); drawPR(); drawList();
}

function drawStats() {
  const ws = weekStart(today()), month = today().slice(0, 7);
  const wk = workouts.filter(w => w.tanggal >= ws);
  const mo = workouts.filter(w => w.tanggal.startsWith(month));
  const mins = wk.reduce((m, w) => m + (w.durasi_menit || 0), 0);
  const vol = wk.reduce((v, w) => v + volumeOf(sets.get(w.id) || []), 0);
  const km = mo.reduce((v, w) => v + distOf(sets.get(w.id) || []), 0);
  const tiles = [
    ['📅', 'Sesi minggu ini', wk.length],
    ['⏱️', 'Menit minggu ini', mins],
    ['🏋️', 'Volume minggu ini', fmtKg(vol)],
    ['🔥', 'Minggu aktif beruntun', weekStreak()],
    ['🗓️', 'Sesi bulan ini', mo.length],
    ['📏', 'Jarak bulan ini', fmtNum(km) + ' km']
  ];
  el.querySelector('#gy-stats').innerHTML = tiles.map(([i, l, v], k) => `
    <div class="card tile" style="--i:${k}"><span class="tile-icon">${i}</span>
      <span class="tile-label">${l}</span><span class="tile-value">${v}</span></div>`).join('');
}

function drawCal() {
  const [y, m] = calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const t = today();
  const byDay = new Map();
  workouts.filter(w => w.tanggal.startsWith(calMonth)).forEach(w => {
    if (!byDay.has(w.tanggal)) byDay.set(w.tanggal, []);
    byDay.get(w.tanggal).push(w);
  });
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<span></span>');
  for (let d = 1; d <= days; d++) {
    const ds = ymd(new Date(y, m - 1, d));
    const ws = byDay.get(ds);
    cells.push(`<span class="cal-day ${ws ? 'has' : ''} ${ds === t ? 'today' : ''}"
      title="${ws ? ws.map(w => w.jenis).join(', ') : ''}">${ws ? jenisOf(ws[0].jenis).icon : d}</span>`);
  }
  const box = el.querySelector('#gy-cal');
  box.innerHTML = `
    <header class="sched-head">
      <h2>🗓️ ${first.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}
        <span class="muted small">${byDay.size} hari latihan</span></h2>
      <div class="date-nav">
        <button class="icon-btn" data-m="-1" aria-label="Bulan sebelumnya">‹</button>
        <button class="icon-btn" data-m="1" aria-label="Bulan berikutnya" ${calMonth >= t.slice(0, 7) ? 'disabled' : ''}>›</button>
      </div>
    </header>
    <div class="cal">
      ${['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map(d => `<b>${d}</b>`).join('')}
      ${cells.join('')}
    </div>`;
  box.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    const d = new Date(y, m - 1 + Number(b.dataset.m), 1);
    calMonth = ymd(d).slice(0, 7);
    drawCal();
  });
}

function drawPR() {
  const prs = [...prMap().values()].sort((a, b) => b.kg - a.kg);
  const box = el.querySelector('#gy-pr');
  box.innerHTML = `
    <header class="sched-head"><h2>🏆 Personal Record</h2></header>
    ${prs.length ? `
      <ul class="pr-list">
        ${prs.slice(0, 8).map(p => `
          <li><button data-ex="${esc(p.name)}">
            <span class="pr-name">${esc(p.name)}</span>
            <span class="pr-val"><b>${fmtNum(p.kg)} kg</b> × ${p.reps}</span>
            <small class="muted">${fmtShort(p.date)}</small>
          </button></li>`).join('')}
      </ul>
      <p class="muted small">Tap latihan untuk melihat grafik progresnya.</p>` :
      '<p class="muted">Rekor muncul otomatis setelah kamu mencatat latihan Gym dengan beban.</p>'}`;
  box.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => openProgress(b.dataset.ex));
}

function workoutSummary(w) {
  const list = sets.get(w.id) || [];
  const mode = jenisOf(w.jenis).mode;
  if (mode === 'cardio') {
    const km = distOf(list);
    const pace = km && w.durasi_menit ? w.durasi_menit / km : 0;
    return km ? `${fmtNum(km)} km${pace ? ` · pace ${Math.floor(pace)}:${String(Math.round((pace % 1) * 60)).padStart(2, '0')}/km` : ''}` : '';
  }
  const groups = groupSets(list);
  return groups.map(g => {
    const top = g.sets.reduce((a, s) => (Number(s.beban_kg) || 0) > (Number(a.beban_kg) || 0) ? s : a, g.sets[0]);
    return `${esc(g.name)} ${g.sets.length}×${top.reps ?? '-'}${Number(top.beban_kg) ? ` @${fmtNum(top.beban_kg)}kg` : ''}`;
  }).join(' · ');
}

function groupSets(list) {
  const out = [];
  for (const s of list) {
    let g = out.find(x => norm(x.name) === norm(s.exercise));
    if (!g) out.push(g = { name: s.exercise, sets: [] });
    g.sets.push(s);
  }
  return out;
}

function drawList() {
  const box = el.querySelector('#gy-list');
  if (!workouts.length) {
    box.innerHTML = `
      <div class="card empty">
        <div class="empty-icon">${persona().mascot}</div>
        <p>${state.readOnly ? 'Belum ada latihan tercatat.' : 'Belum ada latihan. Catat sesi pertamamu — sekecil apa pun tetap dihitung!'}</p>
      </div>`;
    return;
  }
  // Kelompokkan per minggu
  const groups = new Map();
  workouts.slice(0, 60).forEach(w => {
    const ws = weekStart(w.tanggal);
    if (!groups.has(ws)) groups.set(ws, []);
    groups.get(ws).push(w);
  });
  const thisWs = weekStart(today());
  box.innerHTML = [...groups].map(([ws, list]) => {
    const label = ws === thisWs ? 'Minggu ini' : ws === addDays(thisWs, -7) ? 'Minggu lalu' : `${fmtShort(ws)} – ${fmtShort(addDays(ws, 6))}`;
    const mins = list.reduce((m, w) => m + (w.durasi_menit || 0), 0);
    return `
      <h3 class="gy-week">${label} <span class="muted small">${list.length} sesi · ${mins} menit</span></h3>
      <div class="gy-items">
        ${list.map(w => {
          const j = jenisOf(w.jenis), list2 = sets.get(w.id) || [], vol = volumeOf(list2);
          return `
            <button class="card gy-item" data-wid="${w.id}">
              <span class="gy-icon">${j.icon}</span>
              <span class="gy-body">
                <b>${esc(w.jenis)} <span class="muted small">· ${relLabel(w.tanggal)}</span></b>
                <small class="muted">${workoutSummary(w) || esc(w.catatan || '')}</small>
              </span>
              <span class="gy-nums">
                ${w.durasi_menit ? `<span>⏱️ ${w.durasi_menit}m</span>` : ''}
                ${vol ? `<span>🏋️ ${fmtKg(vol)}</span>` : ''}
                ${w.kalori ? `<span>🔥 ${w.kalori}</span>` : ''}
              </span>
            </button>`;
        }).join('')}
      </div>`;
  }).join('');
}

// ---------- Detail ----------
function openDetail(w) {
  const j = jenisOf(w.jenis), list = sets.get(w.id) || [];
  const m = modal({ title: `${j.icon} ${w.jenis} · ${relLabel(w.tanggal)}` });
  const groups = groupSets(list);
  m.body.innerHTML = `
    <div class="stat-grid" style="--c:var(--primary)">
      <div class="stat"><b>${w.durasi_menit || '–'}</b><span>Menit</span></div>
      ${j.mode === 'strength' ? `<div class="stat"><b>${fmtKg(volumeOf(list))}</b><span>Total volume</span></div>`
        : `<div class="stat"><b>${fmtNum(distOf(list)) || '–'}</b><span>Km</span></div>`}
      <div class="stat"><b>${w.kalori || '–'}</b><span>Kalori</span></div>
      <div class="stat"><b>${j.mode === 'strength' ? list.length : fmtShort(w.tanggal)}</b><span>${j.mode === 'strength' ? 'Total set' : 'Tanggal'}</span></div>
    </div>
    ${groups.length && j.mode === 'strength' ? groups.map(g => `
      <div class="ex-block">
        <b>${esc(g.name)}</b>
        <table class="set-table"><thead><tr><th>Set</th><th>Reps</th><th>Beban</th></tr></thead>
          <tbody>${g.sets.map((s, i) => `<tr><td>${i + 1}</td><td>${s.reps ?? '–'}</td><td>${Number(s.beban_kg) ? fmtNum(s.beban_kg) + ' kg' : '–'}</td></tr>`).join('')}</tbody>
        </table>
      </div>`).join('') : ''}
    ${w.catatan ? `<p class="gy-note">📝 ${esc(w.catatan)}</p>` : ''}
    <div class="form-actions" data-edit style="margin-top:14px">
      <button class="btn btn-ghost" data-act="edit">✏️ Edit</button>
      <button class="btn btn-ghost" data-act="dup">🔁 Ulangi hari ini</button>
      <button class="btn btn-ghost danger-text" data-act="del">🗑️ Hapus</button>
    </div>`;
  m.body.querySelector('[data-act=edit]').onclick = () => { m.close(); openForm(w); };
  m.body.querySelector('[data-act=dup]').onclick = () => { m.close(); openForm(null, w); };
  m.body.querySelector('[data-act=del]').onclick = async ev => {
    const b = ev.currentTarget;
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Klik lagi untuk hapus'; return; }
    try { assertCanEdit(); } catch (e) { return toast(e.message, 'error'); }
    const { error } = await sb.from('workouts').delete().eq('id', w.id);
    if (error) return toast(error.message, 'error');
    workouts = workouts.filter(x => x !== w); sets.delete(w.id);
    m.close(); toast('Latihan dihapus'); draw();
  };
}

// ---------- Form catat / edit ----------
function openForm(w = null, template = null) {
  try { assertCanEdit(); } catch (e) { return toast(e.message, 'error'); }
  const src = w || template;
  let jenis = src?.jenis || 'Gym';
  let exercises = src ? groupSets(sets.get(src.id) || []).map(g => ({
    name: g.name, sets: g.sets.map(s => ({ reps: s.reps ?? '', kg: s.beban_kg ?? '' }))
  })) : [];
  let jarak = src ? distOf(sets.get(src.id) || []) || '' : '';

  const known = [...new Set([...[...sets.values()].flat().map(s => s.exercise), ...COMMON])];
  const lastGym = workouts.find(x => x.jenis === 'Gym' && x.id !== w?.id);
  const m = modal({ title: w ? '✏️ Edit Latihan' : '💪 Catat Latihan' });

  m.body.innerHTML = `
    <form class="sched-form gy-form" autocomplete="off">
      <div class="field">
        <span class="field-label">Jenis</span>
        <div class="chips gy-jenis">
          ${JENIS.map(j => `<label class="chip"><input type="radio" name="jenis" value="${j.id}" ${j.id === jenis ? 'checked' : ''}><span>${j.icon} ${j.id}</span></label>`).join('')}
        </div>
      </div>
      <div class="row">
        <label>Tanggal<input type="date" name="tanggal" required max="${today()}" value="${w?.tanggal || today()}"></label>
        <label>Durasi (menit)<input type="number" name="durasi" min="1" max="600" inputmode="numeric" value="${src?.durasi_menit ?? ''}"></label>
        <label><span>Kalori <small class="muted">(opsional)</small></span><input type="number" name="kalori" min="0" max="5000" inputmode="numeric" value="${src?.kalori ?? ''}"></label>
      </div>
      <div id="gf-cardio"></div>
      <div id="gf-strength"></div>
      <label><span>Catatan <small class="muted">(opsional)</small></span><textarea name="catatan" rows="2" maxlength="300" placeholder="Contoh: Hari ini fokus form, energi oke">${esc(src?.catatan || '')}</textarea></label>
      <datalist id="ex-list">${known.map(k => `<option value="${esc(k)}">`).join('')}</datalist>
      <div class="form-actions"><button class="btn" type="submit">💾 Simpan latihan</button></div>
    </form>`;

  const f = m.body.querySelector('form');
  const cardioBox = f.querySelector('#gf-cardio'), strBox = f.querySelector('#gf-strength');

  const renderMode = () => {
    const mode = jenisOf(jenis).mode;
    cardioBox.innerHTML = mode === 'cardio'
      ? `<label>Jarak (km)<input type="number" name="jarak" step="0.01" min="0" inputmode="decimal" value="${jarak}"></label>` : '';
    cardioBox.querySelector('[name=jarak]')?.addEventListener('input', e => jarak = e.target.value);
    if (mode !== 'strength') { strBox.innerHTML = ''; return; }
    if (!exercises.length) exercises.push({ name: '', sets: [{ reps: '', kg: '' }] });
    strBox.innerHTML = `
      <div class="field-label gy-ex-head">
        <span>Latihan</span>
        ${lastGym && !w ? `<button type="button" class="link-btn" data-act="copy">🔁 Salin dari Gym ${relLabel(lastGym.tanggal).toLowerCase()}</button>` : ''}
      </div>
      ${exercises.map((ex, i) => `
        <div class="ex-card" data-i="${i}">
          <div class="ex-top">
            <input class="ex-name" list="ex-list" placeholder="Nama latihan, mis. Bench Press" value="${esc(ex.name)}" maxlength="60">
            <button type="button" class="icon-btn" data-act="rm-ex" title="Hapus latihan">✕</button>
          </div>
          <div class="ex-sets">
            ${ex.sets.map((s, k) => `
              <div class="set-row" data-k="${k}">
                <span class="set-no">${k + 1}</span>
                <input type="number" class="s-reps" min="0" max="999" inputmode="numeric" placeholder="reps" value="${s.reps}">
                <span class="muted">×</span>
                <input type="number" class="s-kg" min="0" max="999" step="0.5" inputmode="decimal" placeholder="kg" value="${s.kg}">
                <span class="muted small">kg</span>
                <button type="button" class="icon-btn sm" data-act="rm-set" title="Hapus set" ${ex.sets.length === 1 ? 'disabled' : ''}>−</button>
              </div>`).join('')}
          </div>
          <button type="button" class="link-btn" data-act="add-set">＋ Set (salin set terakhir)</button>
        </div>`).join('')}
      <button type="button" class="btn btn-ghost btn-sm" data-act="add-ex">＋ Tambah latihan</button>`;
  };

  // Simpan input ke state sebelum render ulang
  const sync = () => {
    strBox.querySelectorAll('.ex-card').forEach(card => {
      const ex = exercises[card.dataset.i];
      ex.name = card.querySelector('.ex-name').value;
      card.querySelectorAll('.set-row').forEach(r => {
        ex.sets[r.dataset.k] = { reps: r.querySelector('.s-reps').value, kg: r.querySelector('.s-kg').value };
      });
    });
  };

  f.querySelectorAll('[name=jenis]').forEach(r => r.onchange = () => { sync(); jenis = r.value; renderMode(); });
  strBox.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    sync();
    const i = Number(b.closest('.ex-card')?.dataset.i);
    switch (b.dataset.act) {
      case 'add-ex': exercises.push({ name: '', sets: [{ reps: '', kg: '' }] }); break;
      case 'rm-ex': exercises.splice(i, 1); break;
      case 'add-set': { const s = exercises[i].sets; s.push({ ...s[s.length - 1] }); break; }
      case 'rm-set': exercises[i].sets.splice(Number(b.closest('.set-row').dataset.k), 1); break;
      case 'copy':
        exercises = groupSets(sets.get(lastGym.id) || []).map(g => ({ name: g.name, sets: g.sets.map(s => ({ reps: s.reps ?? '', kg: s.beban_kg ?? '' })) }));
        if (!f.durasi.value && lastGym.durasi_menit) f.durasi.value = lastGym.durasi_menit;
        break;
    }
    renderMode();
    if (b.dataset.act === 'add-ex') strBox.querySelector('.ex-card:last-of-type .ex-name')?.focus();
  });
  renderMode();

  f.onsubmit = async e => {
    e.preventDefault();
    sync();
    const mode = jenisOf(jenis).mode;
    const row = {
      jenis, tanggal: f.tanggal.value,
      durasi_menit: f.durasi.value ? Number(f.durasi.value) : null,
      kalori: f.kalori.value ? Number(f.kalori.value) : null,
      catatan: f.catatan.value.trim() || null
    };
    let setRows = [];
    if (mode === 'strength') {
      exercises.filter(x => x.name.trim()).forEach(x => x.sets.forEach((s, k) => {
        if (s.reps === '' && s.kg === '') return;
        setRows.push({ exercise: x.name.trim(), set_ke: k + 1, reps: s.reps === '' ? null : Number(s.reps), beban_kg: s.kg === '' ? null : Number(s.kg) });
      }));
    } else if (mode === 'cardio' && Number(jarak) > 0) {
      setRows.push({ exercise: jenis, set_ke: 1, jarak_km: Number(jarak) });
    }
    if (!row.durasi_menit && !setRows.length) return toast('Isi durasi atau minimal 1 set latihan', 'error');

    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const before = prMap(w?.id);

    let saved;
    if (w) {
      const r = await sb.from('workouts').update(row).eq('id', w.id).select().single();
      if (r.error) { btn.disabled = false; return toast('Gagal menyimpan: ' + r.error.message, 'error'); }
      const d = await sb.from('workout_sets').delete().eq('workout_id', w.id);
      if (d.error) { btn.disabled = false; return toast('Gagal memperbarui set: ' + d.error.message, 'error'); }
      saved = r.data;
    } else {
      const r = await sb.from('workouts').insert(row).select().single();
      if (r.error) { btn.disabled = false; return toast('Gagal menyimpan: ' + r.error.message, 'error'); }
      saved = r.data;
    }
    let savedSets = [];
    if (setRows.length) {
      const r = await sb.from('workout_sets').insert(setRows.map(s => ({ ...s, workout_id: saved.id }))).select();
      if (r.error) { btn.disabled = false; return toast('Latihan tersimpan, tapi set gagal: ' + r.error.message, 'error'); }
      savedSets = r.data;
    }

    if (w) Object.assign(w, saved); else workouts.push(saved);
    workouts.sort((a, b) => b.tanggal.localeCompare(a.tanggal) || String(b.created_at).localeCompare(String(a.created_at)));
    sets.set(saved.id, savedSets);
    m.close();
    draw();

    // Rekor baru?
    const newPR = [];
    for (const s of savedSets) {
      const kg = Number(s.beban_kg) || 0;
      if (!kg) continue;
      const old = before.get(norm(s.exercise));
      if (old && (kg > old.kg) && !newPR.some(p => norm(p.name) === norm(s.exercise))) newPR.push({ name: s.exercise, kg });
    }
    if (newPR.length) {
      celebrate();
      setTimeout(() => sticker(`🏆 PR BARU! ${newPR[0].name} ${fmtNum(newPR[0].kg)}kg`), 700);
    } else if (!w) {
      sticker();
    }
  };
}

// ---------- Grafik progres per latihan ----------
function openProgress(name) {
  const k = norm(name);
  const pts = workouts.map(w => {
    const best = (sets.get(w.id) || []).filter(s => norm(s.exercise) === k && Number(s.beban_kg))
      .reduce((a, s) => Math.max(a, Number(s.beban_kg)), 0);
    return best ? { d: w.tanggal, kg: best } : null;
  }).filter(Boolean).sort((a, b) => a.d.localeCompare(b.d));

  const m = modal({ title: `📈 ${name}` });
  if (pts.length < 2) {
    m.body.innerHTML = `<p class="muted">Butuh minimal 2 sesi untuk menampilkan grafik. Sejauh ini: ${pts.length} sesi.</p>`;
    return;
  }
  const W = 560, H = 220, P = { l: 40, r: 16, t: 16, b: 28 };
  const min = Math.min(...pts.map(p => p.kg)), max = Math.max(...pts.map(p => p.kg));
  const lo = Math.max(0, Math.floor((min - (max - min) * .2 - 1) / 5) * 5), hi = Math.ceil((max + (max - min) * .15 + 1) / 5) * 5;
  const x = i => P.l + i * (W - P.l - P.r) / (pts.length - 1);
  const y = v => P.t + (hi - v) * (H - P.t - P.b) / (hi - lo);
  const ticks = Array.from({ length: 4 }, (_, i) => lo + (hi - lo) * i / 3);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.kg).toFixed(1)}`).join('');
  const gain = pts[pts.length - 1].kg - pts[0].kg;

  m.body.innerHTML = `
    <p class="muted small">Beban terberat per sesi · ${pts.length} sesi ·
      <b style="color:var(--text)">${gain >= 0 ? '+' : ''}${fmtNum(gain)} kg</b> sejak ${fmtShort(pts[0].d)}</p>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="line-chart" role="img" aria-label="Grafik beban ${esc(name)}">
        ${ticks.map(v => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
          <text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end" class="axis">${Math.round(v)}</text>`).join('')}
        <path d="${path}" class="line"/>
        ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.kg)}" r="4.5" class="dot"/>
          <rect x="${x(i) - 14}" y="${P.t}" width="28" height="${H - P.t - P.b}" class="hit" data-i="${i}"/>`).join('')}
        <text x="${P.l}" y="${H - 8}" class="axis">${fmtShort(pts[0].d)}</text>
        <text x="${W - P.r}" y="${H - 8}" text-anchor="end" class="axis">${fmtShort(pts[pts.length - 1].d)}</text>
      </svg>
      <div class="chart-tip" hidden></div>
    </div>
    <details class="chart-table"><summary class="muted small">Lihat sebagai tabel</summary>
      <table class="set-table"><thead><tr><th>Tanggal</th><th>Beban terberat</th></tr></thead>
        <tbody>${pts.slice().reverse().map(p => `<tr><td>${fmtShort(p.d)}</td><td>${fmtNum(p.kg)} kg</td></tr>`).join('')}</tbody></table>
    </details>`;

  const svg = m.body.querySelector('svg'), tip = m.body.querySelector('.chart-tip');
  svg.querySelectorAll('.hit').forEach(r => {
    const show = () => {
      const p = pts[r.dataset.i], box = svg.getBoundingClientRect(), sc = box.width / W;
      tip.innerHTML = `<b>${fmtNum(p.kg)} kg</b><span>${fmtShort(p.d)}</span>`;
      tip.style.left = x(Number(r.dataset.i)) * sc + 'px';
      tip.style.top = y(p.kg) * sc + 'px';
      tip.hidden = false;
      svg.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('on', i === Number(r.dataset.i)));
    };
    r.addEventListener('pointerenter', show);
    r.addEventListener('click', show);
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; svg.querySelectorAll('.dot.on').forEach(d => d.classList.remove('on')); });
}
