import { sb } from '../supabase.js';
import { state, assertCanEdit } from '../state.js';
import { toast, esc, modal } from '../ui.js';
import { sticker } from '../fx.js';
import { fetchAll } from '../db.js';
import { money } from '../currency.js';
import { today, relLabel, fmtShort, parse, ymd } from '../date.js';

export const ACC_TYPES = { cash: ['💵', 'Cash'], bank: ['🏦', 'Bank'], ewallet: ['📱', 'E-wallet'], lainnya: ['💳', 'Lainnya'] };
const CAT_ICONS = ['🍜', '☕', '🛒', '🚗', '⛽', '🏠', '💡', '📱', '🎬', '🎮', '👕', '💊', '📚', '🎁', '✈️', '🐶', '💇', '🧾', '💼', '🏫', '📈', '💰', '🎉', '🔧'];
const DEFAULT_CATS = [
  ['🍜', 'Makan & Minum', 'out'], ['🛒', 'Belanja Harian', 'out'], ['🚗', 'Transportasi', 'out'],
  ['🏠', 'Rumah & Tagihan', 'out'], ['📱', 'Pulsa & Internet', 'out'], ['🎬', 'Hiburan', 'out'],
  ['👕', 'Fashion', 'out'], ['💊', 'Kesehatan', 'out'], ['📚', 'Pendidikan', 'out'],
  ['🎁', 'Hadiah & Donasi', 'out'], ['🧾', 'Lainnya', 'out'],
  ['💼', 'Gaji', 'in'], ['🏫', 'Pendapatan Usaha', 'in'], ['🎉', 'Bonus & Hadiah', 'in'],
  ['📈', 'Hasil Investasi', 'in'], ['💰', 'Lainnya', 'in']
];
const BULAN = m => parse(m + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
const shiftMonth = (m, n) => { const d = parse(m + '-01'); d.setMonth(d.getMonth() + n); return ymd(d).slice(0, 7); };

let el, month = today().slice(0, 7);
let accounts = [], cats = [], txns = [], budgets = [];
let filter = { tipe: 'all', q: '', cat: null };

const fmt = n => money(n, state.me?.currency_view);
const catOf = id => cats.find(c => c.id === id);
const accOf = id => accounts.find(a => a.id === id);

// ---------- Hitungan ----------
export function balanceOf(acc, list) {
  let b = Number(acc.saldo_awal) || 0;
  for (const t of list) {
    const v = Number(t.jumlah_idr);
    if (t.tipe === 'in' && t.account_id === acc.id) b += v;
    else if (t.tipe === 'out' && t.account_id === acc.id) b -= v;
    else if (t.tipe === 'transfer') {
      if (t.account_id === acc.id) b -= v;
      if (t.ke_account_id === acc.id) b += v;
    }
  }
  return b;
}

export function monthTotals(list, m) {
  let inc = 0, out = 0;
  for (const t of list) {
    if (!t.tanggal.startsWith(m)) continue;
    if (t.tipe === 'in') inc += Number(t.jumlah_idr);
    if (t.tipe === 'out') out += Number(t.jumlah_idr);
  }
  return { inc, out, net: inc - out };
}

// "50k", "1,5jt", "1.250.000" → angka
export function parseAmount(s) {
  s = String(s).toLowerCase().replace(/\s|rp/g, '');
  let mult = 1;
  if (/(jt|juta)$/.test(s)) { mult = 1e6; s = s.replace(/(jt|juta)$/, ''); }
  else if (/(rb|ribu|k)$/.test(s)) { mult = 1e3; s = s.replace(/(rb|ribu|k)$/, ''); }
  if (mult > 1) return Math.round(parseFloat(s.replace(/\./g, '').replace(',', '.')) * mult) || 0;
  return Number(s.replace(/[^\d]/g, '')) || 0;
}
export const fmtInput = n => n ? n.toLocaleString('id-ID') : '';

// ---------- Halaman ----------
export default {
  async render(root) {
    el = root;
    el.innerHTML = `
      <header class="page-head">
        <div>
          <p class="eyebrow">Personal Finance</p>
          <h1 class="page-title" id="fn-title">Finance</h1>
        </div>
        <div class="date-nav">
          <button class="icon-btn" id="fn-prev" aria-label="Bulan sebelumnya">‹</button>
          <span class="month-label" id="fn-month"></span>
          <button class="icon-btn" id="fn-next" aria-label="Bulan berikutnya">›</button>
          <button class="btn" id="fn-add" data-edit>＋ Transaksi</button>
        </div>
      </header>
      <div class="grid fn-sum" id="fn-sum"></div>
      <section class="acc-strip" id="fn-acc"></section>
      <div class="gy-cols">
        <section class="card" id="fn-cat"></section>
        <section class="card" id="fn-budget"></section>
      </div>
      <section class="card" id="fn-list"></section>
      <button class="fab" id="fn-fab" data-edit aria-label="Tambah transaksi">＋</button>`;

    el.querySelector('#fn-prev').onclick = () => { month = shiftMonth(month, -1); draw(); };
    el.querySelector('#fn-next').onclick = () => { month = shiftMonth(month, 1); draw(); };
    el.querySelector('#fn-add').onclick = () => openTxn();
    el.querySelector('#fn-fab').onclick = () => openTxn();
    await load();
  }
};

async function load() {
  const uid = state.viewing.id;
  const [a, c, t, b] = await Promise.all([
    sb.from('accounts').select('*').eq('user_id', uid).order('created_at'),
    sb.from('fin_categories').select('*').eq('user_id', uid).order('created_at'),
    fetchAll(() => sb.from('transactions').select('*').eq('user_id', uid).order('tanggal', { ascending: false }).order('created_at', { ascending: false })),
    sb.from('budgets').select('*').eq('user_id', uid)
  ]);
  if (a.error) return toast('Gagal memuat finance: ' + a.error.message, 'error');
  accounts = a.data; cats = c.data || []; txns = t.data || []; budgets = b.data || [];
  txns.sort((x, y) => y.tanggal.localeCompare(x.tanggal) || String(y.created_at).localeCompare(String(x.created_at)));

  // Kategori bawaan saat pertama kali dibuka
  if (!cats.length && !state.readOnly) {
    const r = await sb.from('fin_categories').insert(DEFAULT_CATS.map(([icon, nama, tipe]) => ({ icon, nama, tipe }))).select();
    if (!r.error) cats = r.data;
  }
  draw();
}

function draw() {
  const ro = state.readOnly;
  el.querySelector('#fn-title').textContent = ro ? `Finance ${state.viewing.display_name}` : 'Finance';
  el.querySelector('#fn-month').textContent = BULAN(month);
  el.querySelector('#fn-next').disabled = month >= today().slice(0, 7);
  drawSummary(); drawAccounts(); drawCategories(); drawBudget(); drawList();
}

function drawSummary() {
  const total = accounts.filter(a => a.aktif).reduce((s, a) => s + balanceOf(a, txns), 0);
  const cur = monthTotals(txns, month), prev = monthTotals(txns, shiftMonth(month, -1));
  const diff = prev.out ? Math.round((cur.out - prev.out) / prev.out * 100) : null;
  const tiles = [
    ['💰', 'Total saldo', fmt(total), ''],
    ['⬇️', 'Pemasukan', fmt(cur.inc), 'in'],
    ['⬆️', 'Pengeluaran', fmt(cur.out), 'out',
      diff === null ? '' : `<small class="delta ${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}% vs ${BULAN(shiftMonth(month, -1)).split(' ')[0]}</small>`],
    ['📊', 'Selisih bulan ini', (cur.net >= 0 ? '+' : '−') + fmt(Math.abs(cur.net)), cur.net >= 0 ? 'in' : 'out']
  ];
  el.querySelector('#fn-sum').innerHTML = tiles.map(([i, l, v, cls, extra], k) => `
    <div class="card tile" style="--i:${k}"><span class="tile-icon">${i}</span><span class="tile-label">${l}</span>
      <span class="tile-value amt-${cls}">${v}</span>${extra || ''}</div>`).join('');
}

function drawAccounts() {
  const box = el.querySelector('#fn-acc');
  box.innerHTML = accounts.filter(a => a.aktif).map(a => {
    const [ic, lbl] = ACC_TYPES[a.tipe] || ACC_TYPES.lainnya;
    const bal = balanceOf(a, txns);
    return `<button class="card acc-card" data-acc="${a.id}">
      <span class="acc-ic">${ic}</span><span class="acc-name">${esc(a.nama)}</span>
      <small class="muted">${lbl}</small><b class="${bal < 0 ? 'amt-out' : ''}">${fmt(bal)}</b></button>`;
  }).join('') + `<button class="card acc-card acc-new" data-acc="new" data-edit><span class="acc-ic">＋</span><span class="acc-name">Akun baru</span>
      <small class="muted">Cash, bank, e-wallet</small></button>`;
  if (!accounts.some(a => a.aktif) && state.readOnly) box.innerHTML = '<p class="muted">Belum ada akun.</p>';
  box.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => {
    if (state.readOnly) return;
    openAccount(b.dataset.acc === 'new' ? null : accOf(b.dataset.acc));
  });
}

function drawCategories() {
  const box = el.querySelector('#fn-cat');
  const sums = new Map();
  txns.filter(t => t.tipe === 'out' && t.tanggal.startsWith(month))
    .forEach(t => sums.set(t.category_id, (sums.get(t.category_id) || 0) + Number(t.jumlah_idr)));
  const rows = [...sums].map(([id, v]) => ({ c: catOf(id), id, v })).sort((a, b) => b.v - a.v);
  const total = rows.reduce((s, r) => s + r.v, 0), max = rows[0]?.v || 1;
  box.innerHTML = `
    <header class="sched-head"><h2>🧾 Pengeluaran per kategori</h2>
      ${filter.cat ? '<button class="link-btn" data-clear>Hapus filter</button>' : ''}</header>
    ${rows.length ? `<ul class="bars">${rows.map(r => `
      <li><button class="bar-row ${filter.cat === (r.id || 'none') ? 'on' : ''}" data-cat="${r.id || 'none'}" title="Klik untuk filter transaksi">
        <span class="bar-label">${r.c ? esc(r.c.icon) + ' ' + esc(r.c.nama) : '❔ Tanpa kategori'}</span>
        <span class="bar-val">${fmt(r.v)} <small class="muted">${Math.round(r.v / total * 100)}%</small></span>
        <span class="bar-track"><i style="width:${Math.max(2, r.v / max * 100)}%"></i></span>
      </button></li>`).join('')}</ul>` : '<p class="muted">Belum ada pengeluaran di bulan ini.</p>'}`;
  box.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
    filter.cat = filter.cat === b.dataset.cat ? null : b.dataset.cat;
    drawCategories(); drawList();
    el.querySelector('#fn-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  box.querySelector('[data-clear]')?.addEventListener('click', () => { filter.cat = null; drawCategories(); drawList(); });
}

function drawBudget() {
  const box = el.querySelector('#fn-budget');
  const list = budgets.filter(b => b.bulan === month);
  const spent = id => txns.filter(t => t.tipe === 'out' && t.category_id === id && t.tanggal.startsWith(month))
    .reduce((s, t) => s + Number(t.jumlah_idr), 0);
  const totLimit = list.reduce((s, b) => s + Number(b.limit_idr), 0);
  const totSpent = list.reduce((s, b) => s + spent(b.category_id), 0);
  // Sisa hari untuk saran per hari
  const isCur = month === today().slice(0, 7);
  const daysLeft = isCur ? new Date(+month.slice(0, 4), +month.slice(5), 0).getDate() - new Date().getDate() + 1 : 0;

  box.innerHTML = `
    <header class="sched-head"><h2>🎯 Budget ${BULAN(month).split(' ')[0]}</h2>
      <button class="btn btn-ghost btn-sm" data-act="budget" data-edit>⚙️ Atur</button></header>
    ${list.length ? `
      <div class="bud-total">
        <span>${fmt(totSpent)} <span class="muted">/ ${fmt(totLimit)}</span></span>
        ${isCur && totLimit > totSpent ? `<small class="muted">≈ ${fmt(Math.floor((totLimit - totSpent) / daysLeft))} / hari sisa ${daysLeft} hari</small>` : ''}
      </div>
      <ul class="bud-list">${list.map(b => {
        const c = catOf(b.category_id), s = spent(b.category_id), lim = Number(b.limit_idr), p = lim ? s / lim * 100 : 0;
        const st = p >= 100 ? 'over' : p >= 80 ? 'warn' : 'ok';
        return `<li class="bud ${st}">
          <div class="bud-top"><span>${c ? esc(c.icon) + ' ' + esc(c.nama) : '–'}</span>
            <span>${fmt(s)} <span class="muted">/ ${fmt(lim)}</span></span></div>
          <div class="progress"><i style="width:${Math.min(100, p)}%"></i></div>
          <small class="muted">${st === 'over' ? `⚠️ Lewat ${fmt(s - lim)}` : st === 'warn' ? `⚡ Sisa ${fmt(lim - s)} — hati-hati` : `Sisa ${fmt(lim - s)}`}</small>
        </li>`;
      }).join('')}</ul>` :
      `<p class="muted">${state.readOnly ? 'Belum ada budget bulan ini.' : 'Belum ada budget. Atur batas belanja per kategori supaya pengeluaran lebih terkendali.'}</p>`}`;
  box.querySelector('[data-act=budget]').onclick = openBudget;
}

function drawList() {
  const box = el.querySelector('#fn-list');
  let list = txns.filter(t => t.tanggal.startsWith(month));
  if (filter.tipe !== 'all') list = list.filter(t => t.tipe === filter.tipe);
  if (filter.cat) list = list.filter(t => (t.category_id || 'none') === filter.cat && t.tipe === 'out');
  if (filter.q) {
    const q = filter.q.toLowerCase();
    list = list.filter(t => (t.catatan || '').toLowerCase().includes(q) || (catOf(t.category_id)?.nama || '').toLowerCase().includes(q)
      || (accOf(t.account_id)?.nama || '').toLowerCase().includes(q));
  }
  const byDay = new Map();
  list.forEach(t => { if (!byDay.has(t.tanggal)) byDay.set(t.tanggal, []); byDay.get(t.tanggal).push(t); });

  box.innerHTML = `
    <header class="sched-head fn-list-head">
      <h2>📒 Transaksi <span class="muted small">${list.length}</span></h2>
      <div class="fn-filters">
        <div class="seg">${[['all', 'Semua'], ['out', 'Keluar'], ['in', 'Masuk'], ['transfer', 'Transfer']].map(([k, l]) =>
          `<button class="${filter.tipe === k ? 'active' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
        <input type="search" placeholder="🔍 Cari…" value="${esc(filter.q)}" data-allow-ro class="fn-search">
      </div>
    </header>
    ${filter.cat ? `<p class="muted small">Filter kategori: <b>${esc(catOf(filter.cat)?.nama || 'Tanpa kategori')}</b> · <button class="link-btn" data-clear>hapus</button></p>` : ''}
    ${byDay.size ? [...byDay].map(([d, ts]) => {
      const net = ts.reduce((s, t) => s + (t.tipe === 'in' ? 1 : t.tipe === 'out' ? -1 : 0) * Number(t.jumlah_idr), 0);
      return `
        <div class="day-group">
          <div class="day-head"><b>${relLabel(d)}</b><span class="${net >= 0 ? 'amt-in' : 'amt-out'}">${net ? (net > 0 ? '+' : '−') + fmt(Math.abs(net)) : ''}</span></div>
          ${ts.map(txnRow).join('')}
        </div>`;
    }).join('') : `<div class="empty"><div class="empty-icon">🪙</div><p class="muted">${txns.length ? 'Tidak ada transaksi yang cocok.' : state.readOnly ? 'Belum ada transaksi.' : 'Belum ada transaksi. Tekan ＋ Transaksi untuk mulai mencatat.'}</p></div>`}`;

  box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filter.tipe = b.dataset.f; drawList(); });
  const s = box.querySelector('.fn-search');
  s.oninput = () => { filter.q = s.value; const pos = s.selectionStart; drawList(); const n = el.querySelector('.fn-search'); n.focus(); n.setSelectionRange(pos, pos); };
  box.querySelector('[data-clear]')?.addEventListener('click', () => { filter.cat = null; drawCategories(); drawList(); });
  box.querySelectorAll('[data-tid]').forEach(r => r.onclick = () => {
    if (state.readOnly) return;
    openTxn(txns.find(t => t.id === r.dataset.tid));
  });
}

function txnRow(t) {
  const c = catOf(t.category_id), a = accOf(t.account_id), to = accOf(t.ke_account_id);
  const icon = t.tipe === 'transfer' ? '🔄' : c?.icon || '❔';
  const title = t.tipe === 'transfer' ? 'Transfer' : c?.nama || 'Tanpa kategori';
  const sub = t.tipe === 'transfer' ? `${esc(a?.nama || '?')} → ${esc(to?.nama || '?')}` : esc(a?.nama || '');
  const sign = t.tipe === 'in' ? '+' : t.tipe === 'out' ? '−' : '';
  return `
    <button class="txn" data-tid="${t.id}" ${state.readOnly ? 'tabindex="-1"' : ''}>
      <span class="txn-ic">${esc(icon)}</span>
      <span class="txn-body"><b>${esc(title)}</b><small class="muted">${t.catatan ? esc(t.catatan) + ' · ' : ''}${sub}</small></span>
      <span class="txn-amt amt-${t.tipe}">${sign}${fmt(Number(t.jumlah_idr))}</span>
    </button>`;
}

// ---------- Form transaksi ----------
function openTxn(t = null) {
  try { assertCanEdit(); } catch (e) { return toast(e.message, 'error'); }
  const active = accounts.filter(a => a.aktif || a.id === t?.account_id || a.id === t?.ke_account_id);
  if (!active.length) { toast('Buat akun dulu (misal Cash atau rekening bank)'); return openAccount(); }

  let tipe = t?.tipe || 'out';
  let catId = t?.category_id || null;
  const lastAcc = txns[0]?.account_id && accOf(txns[0].account_id)?.aktif ? txns[0].account_id : active[0].id;
  const m = modal({ title: t ? '✏️ Edit Transaksi' : '💸 Transaksi Baru' });

  const accOpts = sel => active.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${(ACC_TYPES[a.tipe] || ACC_TYPES.lainnya)[0]} ${esc(a.nama)}</option>`).join('');

  m.body.innerHTML = `
    <form class="sched-form txn-form" autocomplete="off">
      <div class="seg seg-full" id="tf-tipe">
        <button type="button" data-t="out">⬆️ Pengeluaran</button>
        <button type="button" data-t="in">⬇️ Pemasukan</button>
        <button type="button" data-t="transfer">🔄 Transfer</button>
      </div>
      <label class="amt-field"><span>Jumlah</span>
        <div class="amt-input"><span>Rp</span><input name="jumlah" inputmode="decimal" required placeholder="0"
          value="${t ? fmtInput(Number(t.jumlah_idr)) : ''}"></div>
        <small class="muted" id="tf-prev">Bisa ketik singkat: 25rb, 50k, 1,5jt</small>
      </label>
      <div class="field" id="tf-cat"></div>
      <div class="row">
        <label id="tf-from-l"><span id="tf-from-t">Akun</span><select name="akun">${accOpts(t?.account_id || lastAcc)}</select></label>
        <label id="tf-to-l"><span>Ke akun</span><select name="ke">${accOpts(t?.ke_account_id || active.find(a => a.id !== (t?.account_id || lastAcc))?.id)}</select></label>
        <label>Tanggal<input type="date" name="tanggal" required value="${t?.tanggal || today()}"></label>
      </div>
      <label><span>Catatan <small class="muted">(opsional)</small></span><input name="catatan" maxlength="120" placeholder="Contoh: Makan siang bareng tim" value="${esc(t?.catatan || '')}"></label>
      <div class="form-actions">
        <button class="btn" type="submit">💾 Simpan</button>
        ${t ? '<button class="btn btn-ghost danger-text" type="button" data-act="del">🗑️ Hapus</button>'
            : '<button class="btn btn-ghost" type="button" data-act="again">Simpan & tambah lagi</button>'}
      </div>
    </form>`;

  const f = m.body.querySelector('form');
  const amt = f.jumlah, prev = f.querySelector('#tf-prev');

  const renderTipe = () => {
    f.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('active', b.dataset.t === tipe));
    f.querySelector('#tf-to-l').hidden = tipe !== 'transfer';
    f.querySelector('#tf-from-t').textContent = tipe === 'transfer' ? 'Dari akun' : 'Akun';
    const box = f.querySelector('#tf-cat');
    if (tipe === 'transfer') { box.innerHTML = ''; return; }
    const list = cats.filter(c => c.tipe === tipe);
    if (!list.some(c => c.id === catId)) catId = null;
    box.innerHTML = `
      <div class="field-label gy-ex-head"><span>Kategori</span><button type="button" class="link-btn" data-act="cats">⚙️ Kelola kategori</button></div>
      <div class="chips cat-chips">${list.map(c => `<label class="chip"><input type="radio" name="cat" value="${c.id}" ${c.id === catId ? 'checked' : ''}><span>${esc(c.icon)} ${esc(c.nama)}</span></label>`).join('')}</div>`;
    box.querySelectorAll('[name=cat]').forEach(r => r.onchange = () => catId = r.value);
    box.querySelector('[data-act=cats]').onclick = () => openCategories(tipe, () => renderTipe());
  };
  f.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tipe = b.dataset.t; renderTipe(); });
  renderTipe();

  amt.oninput = () => {
    if (/[a-z]/i.test(amt.value)) {
      const n = parseAmount(amt.value);
      prev.textContent = n ? '= Rp ' + n.toLocaleString('id-ID') : 'Format tidak dikenali';
    } else {
      const n = parseAmount(amt.value);
      amt.value = fmtInput(n);
      prev.textContent = n >= 1000 ? fmt(n) : 'Bisa ketik singkat: 25rb, 50k, 1,5jt';
    }
  };
  setTimeout(() => amt.focus(), 50);

  const save = async again => {
    const jumlah = parseAmount(amt.value);
    if (!jumlah) return toast('Isi jumlah yang valid', 'error');
    if (tipe !== 'transfer' && !catId) return toast('Pilih kategori', 'error');
    if (tipe === 'transfer' && f.akun.value === f.ke.value) return toast('Akun asal & tujuan harus berbeda', 'error');
    const row = {
      tipe, jumlah_idr: jumlah, tanggal: f.tanggal.value, account_id: f.akun.value,
      ke_account_id: tipe === 'transfer' ? f.ke.value : null,
      category_id: tipe === 'transfer' ? null : catId,
      catatan: f.catatan.value.trim() || null
    };
    const q = t ? sb.from('transactions').update(row).eq('id', t.id).select().single()
                : sb.from('transactions').insert(row).select().single();
    const { data, error } = await q;
    if (error) return toast('Gagal menyimpan: ' + error.message, 'error');
    if (t) Object.assign(t, data); else txns.unshift(data);
    txns.sort((a, b) => b.tanggal.localeCompare(a.tanggal) || String(b.created_at).localeCompare(String(a.created_at)));
    if (row.tanggal.slice(0, 7) !== month) month = row.tanggal.slice(0, 7);
    draw();
    checkBudget(row);
    if (again) {
      amt.value = ''; f.catatan.value = ''; prev.textContent = 'Tersimpan ✓ — lanjut transaksi berikutnya';
      amt.focus();
    } else {
      m.close();
      if (!t) toast(`${tipe === 'in' ? 'Pemasukan' : tipe === 'out' ? 'Pengeluaran' : 'Transfer'} ${fmt(jumlah)} tersimpan`);
    }
  };
  f.onsubmit = e => { e.preventDefault(); save(false); };
  f.querySelector('[data-act=again]')?.addEventListener('click', () => save(true));
  f.querySelector('[data-act=del]')?.addEventListener('click', async ev => {
    const b = ev.currentTarget;
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Klik lagi untuk hapus'; return; }
    const { error } = await sb.from('transactions').delete().eq('id', t.id);
    if (error) return toast(error.message, 'error');
    txns = txns.filter(x => x !== t);
    m.close(); toast('Transaksi dihapus'); draw();
  });
}

// Peringatan budget setelah pengeluaran
function checkBudget(row) {
  if (row.tipe !== 'out') return;
  const m = row.tanggal.slice(0, 7);
  const b = budgets.find(x => x.bulan === m && x.category_id === row.category_id);
  if (!b) return;
  const s = txns.filter(t => t.tipe === 'out' && t.category_id === row.category_id && t.tanggal.startsWith(m))
    .reduce((a, t) => a + Number(t.jumlah_idr), 0);
  const lim = Number(b.limit_idr), c = catOf(row.category_id);
  if (s > lim) toast(`⚠️ Budget ${c?.nama} terlewati ${fmt(s - lim)}`, 'error', { duration: 4000 });
  else if (s >= lim * .8) toast(`⚡ Budget ${c?.nama} tinggal ${fmt(lim - s)}`, 'ok', { duration: 4000 });
}

// ---------- Akun ----------
function openAccount(a = null) {
  try { assertCanEdit(); } catch (e) { return toast(e.message, 'error'); }
  const used = a ? txns.some(t => t.account_id === a.id || t.ke_account_id === a.id) : false;
  const m = modal({ title: a ? '✏️ Edit Akun' : '🏦 Akun Baru' });
  m.body.innerHTML = `
    <form class="sched-form" autocomplete="off">
      <label>Nama akun<input name="nama" required maxlength="40" placeholder="Contoh: BCA, GoPay, Dompet" value="${esc(a?.nama || '')}"></label>
      <div class="field"><span class="field-label">Jenis</span>
        <div class="chips">${Object.entries(ACC_TYPES).map(([k, [ic, l]]) =>
          `<label class="chip"><input type="radio" name="tipe" value="${k}" ${(a?.tipe || 'bank') === k ? 'checked' : ''}><span>${ic} ${l}</span></label>`).join('')}</div></div>
      <label class="amt-field"><span>Saldo awal</span>
        <div class="amt-input"><span>Rp</span><input name="saldo" inputmode="decimal" placeholder="0" value="${a ? fmtInput(Number(a.saldo_awal)) : ''}"></div>
        <small class="muted">Saldo saat mulai dicatat di aplikasi ini.</small></label>
      ${a ? `<p class="muted small">Saldo sekarang: <b>${fmt(balanceOf(a, txns))}</b></p>` : ''}
      <div class="form-actions">
        <button class="btn" type="submit">💾 Simpan</button>
        ${a ? (used
          ? `<button class="btn btn-ghost" type="button" data-act="archive">📦 Arsipkan</button>`
          : `<button class="btn btn-ghost danger-text" type="button" data-act="del">🗑️ Hapus</button>`) : ''}
      </div>
      ${a && used ? '<p class="muted small">Akun yang sudah punya transaksi tidak bisa dihapus, tapi bisa diarsipkan (disembunyikan).</p>' : ''}
    </form>`;
  const f = m.body.querySelector('form');
  f.saldo.oninput = () => { if (!/[a-z]/i.test(f.saldo.value)) f.saldo.value = fmtInput(parseAmount(f.saldo.value)); };
  f.onsubmit = async e => {
    e.preventDefault();
    const row = { nama: f.nama.value.trim(), tipe: f.tipe.value, saldo_awal: parseAmount(f.saldo.value) };
    const q = a ? sb.from('accounts').update(row).eq('id', a.id).select().single() : sb.from('accounts').insert(row).select().single();
    const { data, error } = await q;
    if (error) return toast('Gagal menyimpan: ' + error.message, 'error');
    if (a) Object.assign(a, data); else { accounts.push(data); sticker('🏦 Akun siap!'); }
    m.close(); draw();
  };
  f.querySelector('[data-act=archive]')?.addEventListener('click', async () => {
    const { error } = await sb.from('accounts').update({ aktif: false }).eq('id', a.id);
    if (error) return toast(error.message, 'error');
    a.aktif = false; m.close(); toast(`Akun ${a.nama} diarsipkan`); draw();
  });
  f.querySelector('[data-act=del]')?.addEventListener('click', async ev => {
    const b = ev.currentTarget;
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Klik lagi untuk hapus'; return; }
    const { error } = await sb.from('accounts').delete().eq('id', a.id);
    if (error) return toast(error.message, 'error');
    accounts = accounts.filter(x => x !== a); m.close(); toast('Akun dihapus'); draw();
  });
}

// ---------- Kategori ----------
function openCategories(tipe = 'out', onDone) {
  const m = modal({ title: '🏷️ Kelola Kategori', onClose: () => { onDone?.(); draw(); } });
  let tab = tipe, editing = null;
  const render = () => {
    const list = cats.filter(c => c.tipe === tab);
    m.body.innerHTML = `
      <div class="seg seg-full"><button class="${tab === 'out' ? 'active' : ''}" data-tab="out">⬆️ Pengeluaran</button>
        <button class="${tab === 'in' ? 'active' : ''}" data-tab="in">⬇️ Pemasukan</button></div>
      <form class="sched-form cat-form" autocomplete="off">
        <div class="row"><label class="grow">${editing ? 'Edit kategori' : 'Kategori baru'}<input name="nama" required maxlength="30" value="${esc(editing?.nama || '')}" placeholder="Contoh: Kopi"></label></div>
        <div class="chips icons">${CAT_ICONS.map((ic, i) => `<label class="chip"><input type="radio" name="icon" value="${ic}" ${(editing?.icon || CAT_ICONS[0]) === ic ? 'checked' : ''}><span>${ic}</span></label>`).join('')}</div>
        <div class="form-actions" style="margin-top:10px"><button class="btn btn-sm" type="submit">${editing ? '💾 Simpan' : '＋ Tambah'}</button>
          ${editing ? '<button class="btn btn-ghost btn-sm" type="button" data-act="cancel">Batal</button>' : ''}</div>
      </form>
      <ul class="sched-list">${list.map(c => {
        const n = txns.filter(t => t.category_id === c.id).length;
        return `<li data-id="${c.id}"><span class="sl-icon">${esc(c.icon)}</span>
          <span class="sl-body"><b>${esc(c.nama)}</b><small class="muted">${n} transaksi</small></span>
          <span class="sl-actions"><button class="icon-btn" data-act="edit">✏️</button><button class="icon-btn" data-act="del">🗑️</button></span></li>`;
      }).join('')}</ul>`;
    m.body.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; editing = null; render(); });
    const f = m.body.querySelector('form');
    f.querySelector('[data-act=cancel]')?.addEventListener('click', () => { editing = null; render(); });
    f.onsubmit = async e => {
      e.preventDefault();
      const row = { nama: f.nama.value.trim(), icon: f.icon.value, tipe: tab };
      const q = editing ? sb.from('fin_categories').update(row).eq('id', editing.id).select().single()
                        : sb.from('fin_categories').insert(row).select().single();
      const { data, error } = await q;
      if (error) return toast(error.message, 'error');
      if (editing) Object.assign(editing, data); else cats.push(data);
      editing = null; render();
    };
    m.body.querySelector('.sched-list').onclick = async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const c = cats.find(x => x.id === b.closest('[data-id]').dataset.id);
      if (b.dataset.act === 'edit') { editing = c; return render(); }
      if (b.dataset.confirm !== '1') {
        b.dataset.confirm = '1'; b.textContent = 'Yakin?'; b.classList.add('danger');
        return;
      }
      const { error } = await sb.from('fin_categories').delete().eq('id', c.id);
      if (error) return toast(error.message, 'error');
      cats = cats.filter(x => x !== c);
      txns.forEach(t => { if (t.category_id === c.id) t.category_id = null; });
      budgets = budgets.filter(x => x.category_id !== c.id);
      render();
    };
  };
  render();
}

// ---------- Budget ----------
function openBudget() {
  try { assertCanEdit(); } catch (e) { return toast(e.message, 'error'); }
  const outCats = cats.filter(c => c.tipe === 'out');
  const prevM = shiftMonth(month, -1);
  const lim = (m, id) => Number(budgets.find(b => b.bulan === m && b.category_id === id)?.limit_idr || 0);
  const avg = id => {
    const ms = [1, 2, 3].map(k => shiftMonth(month, -k));
    const s = txns.filter(t => t.tipe === 'out' && t.category_id === id && ms.some(x => t.tanggal.startsWith(x)))
      .reduce((a, t) => a + Number(t.jumlah_idr), 0);
    return Math.round(s / 3 / 1000) * 1000;
  };
  const m = modal({ title: `🎯 Budget ${BULAN(month)}` });
  m.body.innerHTML = `
    <form class="sched-form" autocomplete="off">
      <p class="muted small">Kosongkan kalau kategori tidak perlu dibatasi. Angka abu-abu = rata-rata pengeluaran 3 bulan terakhir.</p>
      ${budgets.some(b => b.bulan === prevM) ? `<button type="button" class="link-btn" data-act="copy">📋 Salin budget ${BULAN(prevM)}</button>` : ''}
      <ul class="bud-form">${outCats.map(c => `
        <li><span>${esc(c.icon)} ${esc(c.nama)}${avg(c.id) ? `<small class="muted">rata-rata ${fmt(avg(c.id))}</small>` : ''}</span>
          <div class="amt-input sm"><span>Rp</span><input data-cat="${c.id}" inputmode="decimal" placeholder="—" value="${fmtInput(lim(month, c.id))}"></div></li>`).join('')}
      </ul>
      <div class="form-actions"><button class="btn" type="submit">💾 Simpan budget</button></div>
    </form>`;
  const f = m.body.querySelector('form');
  f.querySelectorAll('[data-cat]').forEach(i => i.oninput = () => { if (!/[a-z]/i.test(i.value)) i.value = fmtInput(parseAmount(i.value)); });
  f.querySelector('[data-act=copy]')?.addEventListener('click', () => {
    f.querySelectorAll('[data-cat]').forEach(i => { const v = lim(prevM, i.dataset.cat); if (v) i.value = fmtInput(v); });
  });
  f.onsubmit = async e => {
    e.preventDefault();
    const ups = [], dels = [];
    f.querySelectorAll('[data-cat]').forEach(i => {
      const v = parseAmount(i.value), id = i.dataset.cat, ex = budgets.find(b => b.bulan === month && b.category_id === id);
      if (v > 0) ups.push({ user_id: state.me.id, category_id: id, bulan: month, limit_idr: v });
      else if (ex) dels.push(ex.id);
    });
    const res = await Promise.all([
      ups.length ? sb.from('budgets').upsert(ups, { onConflict: 'user_id,category_id,bulan' }).select() : { data: [] },
      dels.length ? sb.from('budgets').delete().in('id', dels) : {}
    ]);
    const err = res.find(r => r.error);
    if (err) return toast('Gagal menyimpan budget: ' + err.error.message, 'error');
    budgets = budgets.filter(b => b.bulan !== month).concat(res[0].data || []);
    m.close(); toast('Budget tersimpan'); drawBudget();
  };
}
