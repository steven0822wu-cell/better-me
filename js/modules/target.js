import { sb } from '../supabase.js';
import { state, assertCanEdit } from '../state.js';
import { toast, esc, modal } from '../ui.js';
import { sticker, celebrate, persona } from '../fx.js';
import { fetchAll } from '../db.js';
import { money, getUsdIdr } from '../currency.js';
import { today, fmtShort, parse, addDays } from '../date.js';
import { balanceOf, parseAmount, fmtInput, ACC_TYPES } from './finance.js';
import { position } from './invest.js';

const ICONS = ['🎯', '💰', '🏠', '🚗', '✈️', '🎓', '📚', '🀄', '💪', '🏃', '⚖️', '❤️', '💼', '🧘', '🎸', '🌱', '🏆', '💍', '👶', '🙏'];
const COLORS = ['#7c9cff', '#2f9e44', '#f59f00', '#e62429', '#b08d57', '#ff2bd6', '#00b8d9', '#845ef7'];
const KATEGORI = ['Keuangan', 'Kesehatan', 'Karier & Bisnis', 'Belajar', 'Pribadi', 'Keluarga & Relasi', 'Spiritual', 'Lainnya'];
export const TIPE = {
  manual:    { icon: '✍️', label: 'Angka manual',     desc: 'Update angkanya sendiri (berat badan, jumlah buku, dll.)' },
  milestone: { icon: '☑️', label: 'Checklist langkah', desc: 'Pecah jadi langkah-langkah, progres = langkah selesai' },
  finance:   { icon: '💰', label: 'Saldo tabungan',    desc: 'Otomatis dari saldo akun di Finance' },
  invest:    { icon: '📈', label: 'Nilai investasi',   desc: 'Otomatis dari nilai portofolio di Invest' },
  habit:     { icon: '✅', label: 'Check-in habit',    desc: 'Otomatis dari jumlah centang habit sejak tanggal mulai' },
  gym:       { icon: '🏋️', label: 'Latihan',           desc: 'Otomatis dari jumlah sesi / menit / km latihan' }
};
const GYM_METRIC = { sesi: 'sesi', menit: 'menit', km: 'km' };

let el, targets = [], tab = 'aktif', src = {};
const fmt = n => money(n, state.me?.currency_view);
const isMoney = t => ['finance', 'invest'].includes(t.tipe_progress) || (t.tipe_progress === 'manual' && /^rp$/i.test(t.satuan || ''));
const fmtVal = (t, v) => isMoney(t) ? fmt(v) : `${Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 })}${t.satuan ? ' ' + t.satuan : ''}`;

// ---------- Hitung progres ----------
function current(t) {
  const s = t.sumber || {};
  switch (t.tipe_progress) {
    case 'milestone': {
      const ms = t.milestones || [];
      return { cur: ms.filter(m => m.done).length, target: ms.length };
    }
    case 'finance': {
      const accs = (src.accounts || []).filter(a => s.accounts === 'all' || !s.accounts ? a.aktif : (s.accounts || []).includes(a.id));
      return { cur: accs.reduce((sum, a) => sum + balanceOf(a, src.txns || []), 0), target: Number(t.nilai_target) };
    }
    case 'invest': {
      const val = (src.inv || []).filter(a => !s.jenis || s.jenis === 'all' || a.jenis === s.jenis)
        .reduce((sum, a) => sum + position(a, src.invTx.get(a.id), src.invPr.get(a.id), {}, src.rate).valueIdr, 0);
      return { cur: val, target: Number(t.nilai_target) };
    }
    case 'habit': {
      const ids = s.habits || [];
      const n = (src.hlogs || []).filter(l => ids.includes(l.habit_id) && l.tanggal >= t.mulai).length;
      return { cur: n, target: Number(t.nilai_target) };
    }
    case 'gym': {
      const ws = (src.workouts || []).filter(w => w.tanggal >= t.mulai && (!s.jenis || s.jenis === 'all' || w.jenis === s.jenis));
      const m = s.metric || 'sesi';
      const cur = m === 'sesi' ? ws.length : m === 'menit' ? ws.reduce((x, w) => x + (w.durasi_menit || 0), 0)
        : ws.reduce((x, w) => x + (src.wsets.get(w.id) || []).reduce((y, z) => y + (Number(z.jarak_km) || 0), 0), 0);
      return { cur, target: Number(t.nilai_target) };
    }
    default: return { cur: Number(t.nilai_sekarang) || 0, target: Number(t.nilai_target) || 0 };
  }
}

function prog(t) {
  const { cur, target } = current(t);
  const pct = target > 0 ? Math.max(0, Math.min(100, cur / target * 100)) : 0;
  // Laju: dibanding waktu yang sudah berjalan
  let pace = null;
  if (t.deadline && t.status === 'aktif') {
    const total = Math.max(1, (parse(t.deadline) - parse(t.mulai)) / 864e5);
    const gone = Math.max(0, Math.min(total, (parse(today()) - parse(t.mulai)) / 864e5));
    const expected = gone / total * 100;
    const left = Math.round((parse(t.deadline) - parse(today())) / 864e5);
    pace = { expected, left, diff: pct - expected };
  }
  return { cur, target, pct, pace };
}

// ---------- Halaman ----------
export default {
  async render(root) {
    el = root;
    el.innerHTML = `
      <header class="page-head">
        <div>
          <p class="eyebrow">Target</p>
          <h1 class="page-title" id="tg-title">Target</h1>
        </div>
        <button class="btn" id="tg-add" data-edit>＋ Target</button>
      </header>
      <div class="grid fn-sum" id="tg-sum"></div>
      <div class="ws-bar"><div class="seg" id="tg-tabs"></div></div>
      <div class="tg-grid" id="tg-list"></div>`;
    el.querySelector('#tg-add').onclick = () => openForm();
    el.querySelector('#tg-list').onclick = onClick;
    await load();
  }
};

async function load() {
  const uid = state.viewing.id;
  const { data, error } = await sb.from('targets').select('*').eq('user_id', uid).order('urutan').order('created_at');
  if (!el.isConnected) return;
  if (error) return toast('Gagal memuat target: ' + error.message, 'error');
  targets = data;
  await loadSources(uid);
  if (!el.isConnected) return;
  draw();
  syncStored();
}

// Ambil data modul lain hanya kalau dibutuhkan target yang ada
async function loadSources(uid) {
  const need = new Set(targets.map(t => t.tipe_progress));
  const jobs = [];
  src = { invTx: new Map(), invPr: new Map(), wsets: new Map(), rate: 16000 };
  if (need.has('finance')) jobs.push(
    sb.from('accounts').select('*').eq('user_id', uid).then(r => src.accounts = r.data || []),
    fetchAll(() => sb.from('transactions').select('tipe,jumlah_idr,account_id,ke_account_id').eq('user_id', uid)).then(r => src.txns = r.data || []));
  if (need.has('invest')) jobs.push(
    sb.from('investments').select('*').eq('user_id', uid).then(r => src.inv = r.data || []),
    fetchAll(() => sb.from('invest_txns').select('*').eq('user_id', uid)).then(r => (r.data || []).forEach(x => { if (!src.invTx.has(x.investment_id)) src.invTx.set(x.investment_id, []); src.invTx.get(x.investment_id).push(x); })),
    fetchAll(() => sb.from('invest_prices').select('*').eq('user_id', uid)).then(r => (r.data || []).forEach(x => { if (!src.invPr.has(x.investment_id)) src.invPr.set(x.investment_id, []); src.invPr.get(x.investment_id).push(x); })),
    getUsdIdr().then(r => src.rate = r || 16000));
  if (need.has('habit')) {
    const since = targets.filter(t => t.tipe_progress === 'habit').map(t => t.mulai).sort()[0];
    jobs.push(fetchAll(() => sb.from('habit_logs').select('habit_id,tanggal').eq('user_id', uid).gte('tanggal', since)).then(r => src.hlogs = r.data || []));
  }
  if (need.has('gym')) {
    const since = targets.filter(t => t.tipe_progress === 'gym').map(t => t.mulai).sort()[0];
    jobs.push(
      fetchAll(() => sb.from('workouts').select('id,tanggal,jenis,durasi_menit').eq('user_id', uid).gte('tanggal', since)).then(r => src.workouts = r.data || []),
      fetchAll(() => sb.from('workout_sets').select('workout_id,jarak_km').eq('user_id', uid)).then(r => (r.data || []).forEach(x => { if (!src.wsets.has(x.workout_id)) src.wsets.set(x.workout_id, []); src.wsets.get(x.workout_id).push(x); })));
  }
  await Promise.all(jobs);
}

// Simpan angka progres terbaru (dipakai Home & notifikasi), dan tandai tercapai otomatis
async function syncStored() {
  if (state.readOnly) return;
  const reached = [];
  for (const t of targets) {
    if (t.status !== 'aktif') continue;
    const { cur, target, pct } = prog(t);
    const patch = {};
    if (t.tipe_progress !== 'manual') {
      if (Math.abs(Number(t.nilai_sekarang) - cur) > 0.001) patch.nilai_sekarang = cur;
      if (t.tipe_progress === 'milestone' && Number(t.nilai_target) !== target) patch.nilai_target = target;
    }
    if (target > 0 && pct >= 100) { patch.status = 'tercapai'; patch.tercapai_at = new Date().toISOString(); reached.push(t); }
    if (Object.keys(patch).length) {
      const { error } = await sb.from('targets').update(patch).eq('id', t.id);
      if (!error) Object.assign(t, patch);
    }
  }
  if (reached.length && el.isConnected) {
    draw();
    celebrate();
    setTimeout(() => sticker(`🏆 TARGET TERCAPAI! ${reached[0].judul}`), 700);
  }
}

function draw() {
  el.querySelector('#tg-title').textContent = state.readOnly ? `Target ${state.viewing.display_name}` : 'Target';
  drawSummary(); drawTabs(); drawList();
}

function drawSummary() {
  const act = targets.filter(t => t.status === 'aktif');
  const avg = act.length ? act.reduce((s, t) => s + prog(t).pct, 0) / act.length : 0;
  const year = today().slice(0, 4);
  const done = targets.filter(t => t.status === 'tercapai' && (t.tercapai_at || '').startsWith(year)).length;
  const next = act.filter(t => t.deadline && t.deadline >= today()).sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
  const behind = act.filter(t => { const p = prog(t).pace; return p && p.diff < -10; }).length;
  const tiles = [
    ['🎯', 'Target aktif', act.length, behind ? `<small class="amt-out">⚠️ ${behind} tertinggal</small>` : act.length ? '<small class="amt-in">Semua on track</small>' : ''],
    ['📊', 'Rata-rata progres', Math.round(avg) + '%', `<div class="progress progress-sm"><i style="width:${avg}%"></i></div>`],
    ['🏆', `Tercapai ${year}`, done, ''],
    ['⏰', 'Deadline terdekat', next ? fmtShort(next.deadline) : '–', next ? `<small class="muted">${esc(next.judul)}</small>` : '']
  ];
  el.querySelector('#tg-sum').innerHTML = tiles.map(([i, l, v, x], k) => `
    <div class="card tile" style="--i:${k}"><span class="tile-icon">${i}</span><span class="tile-label">${l}</span>
      <span class="tile-value">${v}</span>${x}</div>`).join('');
}

function drawTabs() {
  const n = s => targets.filter(t => t.status === s).length;
  const box = el.querySelector('#tg-tabs');
  box.innerHTML = [['aktif', '🎯 Aktif'], ['tercapai', '🏆 Tercapai'], ['batal', '🗃️ Arsip']].map(([k, l]) =>
    `<button class="${tab === k ? 'active' : ''}" data-tab="${k}">${l} (${n(k)})</button>`).join('');
  box.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; drawTabs(); drawList(); });
}

function drawList() {
  const list = targets.filter(t => t.status === tab);
  const box = el.querySelector('#tg-list');
  if (!list.length) {
    box.innerHTML = `<div class="card empty ws-empty"><div class="empty-icon">${tab === 'tercapai' ? '🏆' : persona().mascot}</div>
      <p class="muted">${tab === 'aktif' ? (state.readOnly ? 'Belum ada target aktif.' : 'Belum ada target. Tulis satu tujuan besar — lalu biarkan progresnya terisi otomatis dari modul lain.')
        : tab === 'tercapai' ? 'Belum ada target yang tercapai. Pasti segera!' : 'Arsip kosong.'}</p></div>`;
    return;
  }
  box.innerHTML = list.map((t, i) => card(t, i)).join('');
}

function card(t, i) {
  const p = prog(t), tp = TIPE[t.tipe_progress] || TIPE.manual;
  const ms = t.milestones || [];
  let paceHtml = '';
  if (p.pace) {
    const { left, diff } = p.pace;
    const when = left < 0 ? `Lewat ${-left} hari` : left === 0 ? 'Deadline hari ini' : `${left} hari lagi`;
    const st = left < 0 ? 'late' : diff >= -5 ? 'ok' : diff >= -20 ? 'warn' : 'late';
    const lbl = st === 'ok' ? '✅ On track' : st === 'warn' ? '⚡ Sedikit tertinggal' : left < 0 ? '⏰ Lewat deadline' : '⚠️ Tertinggal';
    let need = '';
    if (left > 0 && p.target > p.cur && t.tipe_progress !== 'milestone') {
      const perMonth = (p.target - p.cur) / Math.max(1, left / 30.4);
      need = left > 45 ? ` · perlu ${fmtVal(t, Math.ceil(perMonth))}/bulan` : ` · perlu ${fmtVal(t, Math.ceil((p.target - p.cur) / Math.max(1, left / 7)))}/minggu`;
    }
    paceHtml = `<div class="tg-pace ${st}"><span>${lbl}</span><small>${when}${need}</small></div>`;
  }
  return `
    <article class="card tg-card ${t.status}" data-id="${t.id}" style="--c:${esc(t.warna)};--i:${i}">
      <div class="tg-top">
        <div class="ring tg-ring" style="--pct:${p.pct}"><span>${Math.floor(p.pct)}%</span></div>
        <div class="tg-head">
          <button class="tg-name" data-act="detail">${esc(t.icon)} ${esc(t.judul)}</button>
          <div class="tg-tags"><span class="pill">${esc(t.kategori || 'Lainnya')}</span><span class="muted small">${tp.icon} ${tp.label}</span></div>
        </div>
      </div>
      <div class="tg-val">
        <b>${t.tipe_progress === 'milestone' ? `${p.cur} / ${p.target} langkah` : fmtVal(t, p.cur)}</b>
        ${t.tipe_progress !== 'milestone' && p.target ? `<span class="muted">dari ${fmtVal(t, p.target)}</span>` : ''}
      </div>
      <div class="progress"><i style="width:${p.pct}%"></i></div>
      ${t.status === 'tercapai' ? `<div class="tg-pace ok"><span>🏆 Tercapai</span><small>${t.tercapai_at ? fmtShort(t.tercapai_at.slice(0, 10)) : ''}</small></div>` : paceHtml}
      ${t.tipe_progress === 'milestone' && ms.length ? `
        <ul class="tg-ms">${ms.slice(0, 4).map(m => `
          <li><label class="${m.done ? 'done' : ''}"><input type="checkbox" data-ms="${esc(m.id)}" ${m.done ? 'checked' : ''} ${state.readOnly || t.status !== 'aktif' ? 'disabled' : ''}>
            <span>${esc(m.judul)}</span></label></li>`).join('')}
          ${ms.length > 4 ? `<li class="muted small">+${ms.length - 4} langkah lagi</li>` : ''}</ul>` : ''}
      ${t.status === 'aktif' ? `<div class="ws-actions" data-edit>
        ${t.tipe_progress === 'manual' ? '<button class="btn btn-sm" data-act="update">✍️ Update progres</button>' : ''}
        <button class="btn btn-ghost btn-sm" data-act="edit">✏️ Edit</button></div>` : ''}
    </article>`;
}

async function onClick(e) {
  const card = e.target.closest('[data-id]');
  if (!card) return;
  const t = targets.find(x => x.id === card.dataset.id);
  const ms = e.target.closest('[data-ms]');
  if (ms) return toggleMilestone(t, ms.dataset.ms, ms);
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'detail') return openDetail(t);
  try { assertCanEdit(); } catch (err) { return toast(err.message, 'error'); }
  if (b.dataset.act === 'edit') return openForm(t);
  if (b.dataset.act === 'update') return openUpdate(t);
}

async function toggleMilestone(t, id, input) {
  try { assertCanEdit(); } catch (err) { input.checked = !input.checked; return toast(err.message, 'error'); }
  const milestones = (t.milestones || []).map(m => m.id === id ? { ...m, done: input.checked } : m);
  const { error } = await sb.from('targets').update({ milestones }).eq('id', t.id);
  if (error) { input.checked = !input.checked; return toast(error.message, 'error'); }
  t.milestones = milestones;
  if (input.checked) { const r = input.getBoundingClientRect(); sticker(null, r.left + 80, r.top - 10); }
  draw(); syncStored();
}

// ---------- Update progres manual ----------
function openUpdate(t) {
  const m = modal({ title: `✍️ Update · ${t.judul}` });
  const money1 = isMoney(t);
  m.body.innerHTML = `
    <form class="sched-form" autocomplete="off">
      <p class="muted small">Sekarang ${fmtVal(t, Number(t.nilai_sekarang))} dari ${fmtVal(t, Number(t.nilai_target))}</p>
      <label class="amt-field"><span>Angka terbaru${t.satuan ? ` (${esc(t.satuan)})` : ''}</span>
        <div class="amt-input">${money1 ? '<span>Rp</span>' : ''}<input name="v" inputmode="decimal" required value="${money1 ? fmtInput(Number(t.nilai_sekarang)) : Number(t.nilai_sekarang)}"></div></label>
      <div class="suggest" style="justify-content:flex-start">
        ${[1, 5, 10].map(n => `<button type="button" class="chip-btn" data-d="${money1 ? n * 100000 : n}">＋${money1 ? fmt(n * 100000) : n}</button>`).join('')}
      </div>
      <div class="form-actions" style="margin-top:14px"><button class="btn" type="submit">💾 Simpan</button></div>
    </form>`;
  const f = m.body.querySelector('form');
  const read = () => money1 ? parseAmount(f.v.value) : Number(String(f.v.value).replace(',', '.')) || 0;
  if (money1) f.v.oninput = () => { if (!/[a-z]/i.test(f.v.value)) f.v.value = fmtInput(parseAmount(f.v.value)); };
  f.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
    const v = read() + Number(b.dataset.d);
    f.v.value = money1 ? fmtInput(v) : String(v);
  });
  f.v.select();
  f.onsubmit = async e => {
    e.preventDefault();
    const v = read();
    const { error } = await sb.from('targets').update({ nilai_sekarang: v }).eq('id', t.id);
    if (error) return toast(error.message, 'error');
    const up = v > Number(t.nilai_sekarang);
    t.nilai_sekarang = v;
    m.close(); draw(); if (up) sticker(); syncStored();
  };
}

// ---------- Tambah / edit ----------
async function openForm(t = null) {
  try { assertCanEdit(); } catch (err) { return toast(err.message, 'error'); }
  const uid = state.me.id;
  // Pilihan sumber dari modul lain
  const [acc, hab, inv] = await Promise.all([
    sb.from('accounts').select('id,nama,tipe,aktif').eq('user_id', uid).eq('aktif', true),
    sb.from('habits').select('id,nama,icon,aktif').eq('user_id', uid).eq('aktif', true),
    sb.from('investments').select('jenis').eq('user_id', uid)
  ]);
  const accounts = acc.data || [], habits = hab.data || [];
  const invJenis = [...new Set((inv.data || []).map(x => x.jenis))];

  let tipe = t?.tipe_progress || 'manual';
  let milestones = (t?.milestones || []).map(x => ({ ...x }));
  const s = t?.sumber || {};
  const m = modal({ title: t ? '✏️ Edit Target' : '🎯 Target Baru' });

  const render = () => {
    const keep = m.body.querySelector('form') ? snapshot() : null;
    m.body.innerHTML = `
      <form class="sched-form" autocomplete="off">
        <label>Target kamu<input name="judul" required maxlength="80" placeholder="Contoh: Dana darurat 50 juta, Lulus HSK 4, Turun 5 kg" value="${esc(keep?.judul ?? t?.judul ?? '')}"></label>
        <div class="row">
          <label>Kategori<select name="kategori">${KATEGORI.map(k => `<option ${k === (keep?.kategori ?? t?.kategori ?? 'Pribadi') ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
          <label>Mulai<input type="date" name="mulai" required value="${keep?.mulai ?? t?.mulai ?? today()}"></label>
          <label><span>Deadline <small class="muted">(opsional)</small></span><input type="date" name="deadline" value="${keep?.deadline ?? t?.deadline ?? ''}"></label>
        </div>

        <div class="field"><span class="field-label">Cara mengukur progres</span>
          <div class="tipe-grid">${Object.entries(TIPE).map(([k, v]) => `
            <label class="tipe-opt"><input type="radio" name="tipe" value="${k}" ${k === tipe ? 'checked' : ''}>
              <span><b>${v.icon} ${v.label}</b><small>${v.desc}</small></span></label>`).join('')}</div>
        </div>

        <div class="tipe-box">${tipeFields(keep)}</div>

        <label><span>Kenapa target ini penting? <small class="muted">(opsional, jadi pengingat motivasi)</small></span>
          <textarea name="deskripsi" rows="2" maxlength="300">${esc(keep?.deskripsi ?? t?.deskripsi ?? '')}</textarea></label>
        <div class="field"><span class="field-label">Ikon</span>
          <div class="chips icons">${ICONS.map(ic => `<label class="chip"><input type="radio" name="icon" value="${ic}" ${(keep?.icon ?? t?.icon ?? '🎯') === ic ? 'checked' : ''}><span>${ic}</span></label>`).join('')}</div></div>
        <div class="field"><span class="field-label">Warna</span>
          <div class="chips colors">${COLORS.map(c => `<label class="chip color"><input type="radio" name="warna" value="${c}" ${(keep?.warna ?? t?.warna ?? COLORS[0]) === c ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div></div>
        <div class="form-actions">
          <button class="btn" type="submit">💾 Simpan</button>
          ${t ? `
            ${t.status === 'aktif' ? '<button class="btn btn-ghost" type="button" data-act="done">🏆 Tandai tercapai</button><button class="btn btn-ghost" type="button" data-act="archive">🗃️ Arsipkan</button>'
              : '<button class="btn btn-ghost" type="button" data-act="reopen">↩️ Aktifkan lagi</button>'}
            <button class="btn btn-ghost danger-text" type="button" data-act="del">🗑️ Hapus</button>` : ''}
        </div>
      </form>`;
    bindForm();
  };

  const tipeFields = keep => {
    const val = keep?.nilai ?? (t && tipe === t.tipe_progress ? t.nilai_target : '');
    const moneyTipe = tipe === 'finance' || tipe === 'invest';
    switch (tipe) {
      case 'manual': return `
        <div class="row">
          <label>Angka awal<input name="awal" inputmode="decimal" value="${keep?.awal ?? t?.nilai_sekarang ?? 0}"></label>
          <label>Angka target<input name="nilai" inputmode="decimal" required value="${val || ''}"></label>
          <label>Satuan<input name="satuan" maxlength="15" placeholder="kg, buku, Rp, km" value="${esc(keep?.satuan ?? t?.satuan ?? '')}"></label>
        </div>
        <p class="muted small">Tip: untuk target turun (misal berat badan 80 → 75 kg), isi sebagai "kg yang sudah turun": awal 0, target 5.</p>`;
      case 'milestone': return `
        <div class="ms-edit">${milestones.map((x, i) => `
          <div class="ms-row" data-i="${i}"><input type="checkbox" ${x.done ? 'checked' : ''} data-f="done">
            <input data-f="judul" value="${esc(x.judul)}" maxlength="80" placeholder="Langkah ${i + 1}">
            <button type="button" class="icon-btn sm" data-rm="${i}">✕</button></div>`).join('')}</div>
        <button type="button" class="btn btn-ghost btn-sm" data-act="add-ms">＋ Tambah langkah</button>`;
      case 'finance': return accounts.length ? `
        <label class="amt-field"><span>Target saldo</span><div class="amt-input"><span>Rp</span><input name="nilai" inputmode="decimal" required value="${val ? fmtInput(Number(val)) : ''}"></div></label>
        <div class="field"><span class="field-label">Akun yang dihitung</span>
          <div class="chips">
            <label class="chip"><input type="checkbox" name="acc" value="all" ${!s.accounts || s.accounts === 'all' ? 'checked' : ''}><span>Semua akun</span></label>
            ${accounts.map(a => `<label class="chip"><input type="checkbox" name="acc" value="${a.id}" ${Array.isArray(s.accounts) && s.accounts.includes(a.id) ? 'checked' : ''}><span>${(ACC_TYPES[a.tipe] || ACC_TYPES.lainnya)[0]} ${esc(a.nama)}</span></label>`).join('')}
          </div><small class="muted">Contoh: pilih hanya rekening tabungan untuk target dana darurat.</small></div>`
        : '<p class="muted">Belum ada akun di Finance. Buat akun dulu, atau pilih cara lain.</p>';
      case 'invest': return `
        <label class="amt-field"><span>Target nilai portofolio</span><div class="amt-input"><span>Rp</span><input name="nilai" inputmode="decimal" required value="${val ? fmtInput(Number(val)) : ''}"></div></label>
        <label>Aset yang dihitung<select name="jenis"><option value="all">Semua investasi</option>
          ${invJenis.map(j => `<option value="${j}" ${s.jenis === j ? 'selected' : ''}>${j}</option>`).join('')}</select></label>`;
      case 'habit': return habits.length ? `
        <label>Target jumlah check-in<input name="nilai" inputmode="numeric" required placeholder="Contoh: 100" value="${val || ''}"></label>
        <div class="field"><span class="field-label">Habit yang dihitung</span>
          <div class="chips">${habits.map(h => `<label class="chip"><input type="checkbox" name="hab" value="${h.id}" ${(s.habits || []).includes(h.id) ? 'checked' : ''}><span>${esc(h.icon)} ${esc(h.nama)}</span></label>`).join('')}</div>
          <small class="muted">Dihitung sejak tanggal mulai. Contoh: "Baca buku 100 hari".</small></div>`
        : '<p class="muted">Belum ada habit. Buat habit dulu, atau pilih cara lain.</p>';
      case 'gym': return `
        <div class="row">
          <label>Target<input name="nilai" inputmode="decimal" required placeholder="Contoh: 50" value="${val || ''}"></label>
          <label>Satuan<select name="metric">${Object.entries(GYM_METRIC).map(([k, l]) => `<option value="${k}" ${(s.metric || 'sesi') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Jenis<select name="gjenis"><option value="all">Semua olahraga</option>
            ${['Gym', 'Lari', 'Jalan', 'Sepeda', 'Renang', 'Badminton', 'Futsal', 'Basket', 'Yoga'].map(j => `<option ${s.jenis === j ? 'selected' : ''}>${j}</option>`).join('')}</select></label>
        </div>`;
    }
    return '';
  };

  const snapshot = () => {
    const f = m.body.querySelector('form');
    syncMs();
    return { judul: f.judul.value, kategori: f.kategori.value, mulai: f.mulai.value, deadline: f.deadline.value,
      deskripsi: f.deskripsi.value, icon: f.icon.value, warna: f.warna.value };
  };
  const syncMs = () => m.body.querySelectorAll('.ms-row').forEach(r => {
    const x = milestones[r.dataset.i];
    x.judul = r.querySelector('[data-f=judul]').value; x.done = r.querySelector('[data-f=done]').checked;
  });

  const bindForm = () => {
    const f = m.body.querySelector('form');
    f.querySelectorAll('[name=tipe]').forEach(r => r.onchange = () => { tipe = r.value; render(); });
    f.querySelector('[data-act=add-ms]')?.addEventListener('click', () => {
      syncMs(); milestones.push({ id: crypto.randomUUID().slice(0, 8), judul: '', done: false });
      render(); m.body.querySelector('.ms-row:last-child [data-f=judul]')?.focus();
    });
    f.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { syncMs(); milestones.splice(Number(b.dataset.rm), 1); render(); });
    if (tipe === 'milestone' && !milestones.length) { milestones.push({ id: crypto.randomUUID().slice(0, 8), judul: '', done: false }); render(); return; }
    // Semua akun ⇄ akun tertentu
    const accs = [...f.querySelectorAll('[name=acc]')];
    accs.forEach(c => c.onchange = () => {
      if (c.value === 'all' && c.checked) accs.forEach(x => { if (x !== c) x.checked = false; });
      else if (c.checked) accs.find(x => x.value === 'all').checked = false;
    });
    if (f.nilai && (tipe === 'finance' || tipe === 'invest'))
      f.nilai.oninput = () => { if (!/[a-z]/i.test(f.nilai.value)) f.nilai.value = fmtInput(parseAmount(f.nilai.value)); };

    f.onsubmit = async e => {
      e.preventDefault();
      syncMs();
      const num = v => (tipe === 'finance' || tipe === 'invest') ? parseAmount(v) : Number(String(v).replace(',', '.')) || 0;
      const row = {
        judul: f.judul.value.trim(), kategori: f.kategori.value, mulai: f.mulai.value, deadline: f.deadline.value || null,
        deskripsi: f.deskripsi.value.trim() || null, icon: f.icon.value, warna: f.warna.value, tipe_progress: tipe,
        sumber: {}, milestones: [], satuan: null
      };
      if (row.deadline && row.deadline < row.mulai) return toast('Deadline harus setelah tanggal mulai', 'error');
      if (tipe === 'milestone') {
        row.milestones = milestones.filter(x => x.judul.trim()).map(x => ({ ...x, judul: x.judul.trim() }));
        if (!row.milestones.length) return toast('Isi minimal 1 langkah', 'error');
        row.nilai_target = row.milestones.length;
        row.nilai_sekarang = row.milestones.filter(x => x.done).length;
      } else {
        if (!f.nilai) return toast('Lengkapi data untuk cara pengukuran ini', 'error');
        row.nilai_target = num(f.nilai.value);
        if (!(row.nilai_target > 0)) return toast('Isi angka target', 'error');
      }
      if (tipe === 'manual') { row.nilai_sekarang = Number(String(f.awal.value).replace(',', '.')) || 0; row.satuan = f.satuan.value.trim() || null; }
      if (tipe === 'finance') {
        const sel = [...f.querySelectorAll('[name=acc]:checked')].map(c => c.value);
        row.sumber = { accounts: !sel.length || sel.includes('all') ? 'all' : sel };
      }
      if (tipe === 'invest') row.sumber = { jenis: f.jenis.value };
      if (tipe === 'habit') {
        row.sumber = { habits: [...f.querySelectorAll('[name=hab]:checked')].map(c => c.value) };
        if (!row.sumber.habits.length) return toast('Pilih minimal 1 habit', 'error');
        row.satuan = 'check-in';
      }
      if (tipe === 'gym') { row.sumber = { metric: f.metric.value, jenis: f.gjenis.value }; row.satuan = GYM_METRIC[f.metric.value]; }

      const q = t ? sb.from('targets').update(row).eq('id', t.id).select().single()
                  : sb.from('targets').insert({ ...row, urutan: targets.length }).select().single();
      const { data, error } = await q;
      if (error) return toast('Gagal menyimpan: ' + (/column|schema cache/i.test(error.message) ? 'jalankan dulu 06_target.sql di Supabase' : error.message), 'error');
      if (t) Object.assign(t, data); else { targets.push(data); sticker('🎯 Target dipasang!'); }
      m.close(); tab = 'aktif';
      await loadSources(state.viewing.id);
      draw(); syncStored();
    };

    const setStatus = async (status, msg) => {
      const { error } = await sb.from('targets').update({ status, tercapai_at: status === 'tercapai' ? new Date().toISOString() : null }).eq('id', t.id);
      if (error) return toast(error.message, 'error');
      t.status = status; t.tercapai_at = status === 'tercapai' ? new Date().toISOString() : null;
      m.close(); tab = status; draw();
      if (status === 'tercapai') { celebrate(); setTimeout(() => sticker('🏆 TARGET TERCAPAI!'), 700); } else toast(msg);
    };
    f.querySelector('[data-act=done]')?.addEventListener('click', () => setStatus('tercapai'));
    f.querySelector('[data-act=archive]')?.addEventListener('click', () => setStatus('batal', 'Target diarsipkan'));
    f.querySelector('[data-act=reopen]')?.addEventListener('click', () => setStatus('aktif', 'Target aktif lagi'));
    f.querySelector('[data-act=del]')?.addEventListener('click', async ev => {
      const b = ev.currentTarget;
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Klik lagi untuk hapus'; return; }
      const { error } = await sb.from('targets').delete().eq('id', t.id);
      if (error) return toast(error.message, 'error');
      targets = targets.filter(x => x !== t); m.close(); toast('Target dihapus'); draw();
    });
  };
  render();
}

// ---------- Detail ----------
function openDetail(t) {
  const p = prog(t), tp = TIPE[t.tipe_progress] || TIPE.manual;
  const m = modal({ title: `${t.icon} ${t.judul}` });
  m.body.innerHTML = `
    <div class="stat-grid" style="--c:${esc(t.warna)}">
      <div class="stat"><b>${Math.floor(p.pct)}%</b><span>Progres</span></div>
      <div class="stat"><b>${t.tipe_progress === 'milestone' ? `${p.cur}/${p.target}` : fmtVal(t, p.cur)}</b><span>${t.tipe_progress === 'milestone' ? 'Langkah selesai' : 'Sekarang'}</span></div>
      <div class="stat"><b>${t.tipe_progress === 'milestone' ? p.target : fmtVal(t, p.target)}</b><span>Target</span></div>
      <div class="stat"><b>${t.deadline ? (p.pace ? (p.pace.left >= 0 ? p.pace.left + ' hari' : 'Lewat') : fmtShort(t.deadline)) : '–'}</b><span>${t.deadline ? 'Sisa waktu · ' + fmtShort(t.deadline) : 'Tanpa deadline'}</span></div>
    </div>
    <p class="muted small">${esc(t.kategori || '')} · ${tp.icon} ${tp.label} · mulai ${fmtShort(t.mulai)}</p>
    ${p.pace && t.status === 'aktif' ? `<div class="pace-bar"><div class="progress"><i style="width:${p.pct}%"></i></div>
      <span class="pace-mark" style="left:${p.pace.expected}%" title="Seharusnya sudah ${Math.round(p.pace.expected)}%"></span>
      <small class="muted">Garis = posisi ideal hari ini (${Math.round(p.pace.expected)}%)</small></div>` : ''}
    ${t.deskripsi ? `<blockquote class="tg-why">💭 ${esc(t.deskripsi)}</blockquote>` : ''}
    ${t.tipe_progress === 'milestone' ? `<ul class="tg-ms full">${(t.milestones || []).map(x => `<li><label class="${x.done ? 'done' : ''}"><input type="checkbox" disabled ${x.done ? 'checked' : ''}><span>${esc(x.judul)}</span></label></li>`).join('')}</ul>` : ''}
    <div class="form-actions" data-edit style="margin-top:14px">
      ${t.tipe_progress === 'manual' && t.status === 'aktif' ? '<button class="btn btn-sm" data-act="update">✍️ Update progres</button>' : ''}
      <button class="btn btn-ghost btn-sm" data-act="edit">✏️ Edit</button>
    </div>`;
  m.body.querySelector('[data-act=update]')?.addEventListener('click', () => { m.close(); openUpdate(t); });
  m.body.querySelector('[data-act=edit]').onclick = () => { m.close(); openForm(t); };
}
