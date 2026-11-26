import { sb } from '../supabase.js';
import { state, assertCanEdit } from '../state.js';
import { toast, esc, modal } from '../ui.js';
import { sticker, celebrate, persona } from '../fx.js';
import { fetchAll } from '../db.js';
import { money, getUsdIdr, getCryptoPrices, searchCoins } from '../currency.js';
import { today, fmtShort, relLabel } from '../date.js';
import { parseAmount, fmtInput } from './finance.js';

export const JENIS = {
  saham:     { icon: '📊', label: 'Saham',      unit: 'lembar', cur: 'IDR' },
  reksadana: { icon: '🧺', label: 'Reksa Dana', unit: 'unit',   cur: 'IDR' },
  emas:      { icon: '🪙', label: 'Emas',       unit: 'gram',   cur: 'IDR' },
  crypto:    { icon: '₿',  label: 'Crypto',     unit: 'koin',   cur: 'IDR' },
  deposito:  { icon: '🏦', label: 'Deposito',   unit: '',       cur: 'IDR' },
  obligasi:  { icon: '📜', label: 'Obligasi',   unit: 'unit',   cur: 'IDR' },
  lainnya:   { icon: '💼', label: 'Lainnya',    unit: 'unit',   cur: 'IDR' }
};

let el, assets = [], txns = new Map(), prices = new Map(), live = {}, rate = 16000, liveAt = null;

const fmt = n => money(n, state.me?.currency_view);
const fmtNative = (n, cur) => cur === 'IDR'
  ? 'Rp ' + Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 })
  : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) < 1 ? 6 : 2 });
const fmtUnit = n => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 8 });
const pctStr = p => (p >= 0 ? '+' : '') + p.toFixed(2).replace('.', ',') + '%';
// "1.250.000" → 1250000 · "1.250,5" → 1250.5 · "0,5" / "0.5" → 0.5
export function num(s) {
  s = String(s).trim().replace(/\s|rp|\$/gi, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return Number(s) || 0;
}

// ---------- Hitungan posisi (metode harga rata-rata) ----------
export function position(a, list, priceList, liveMap, usdIdr) {
  let units = 0, cost = 0, realized = 0;
  const sorted = [...(list || [])].sort((x, y) => x.tanggal.localeCompare(y.tanggal) || String(x.created_at).localeCompare(String(y.created_at)));
  for (const t of sorted) {
    const u = Number(t.unit), h = Number(t.harga), fee = Number(t.fee) || 0;
    if (t.tipe === 'beli') { units += u; cost += u * h + fee; }
    else {
      const avg = units ? cost / units : 0;
      realized += u * h - fee - avg * u;
      cost -= avg * u; units -= u;
    }
  }
  if (units < 1e-9) { units = 0; cost = 0; }
  const lastPrice = [...(priceList || [])].sort((x, y) => y.tanggal.localeCompare(x.tanggal))[0];
  const lastTxn = sorted[sorted.length - 1];
  let price = null, priceDate = null, priceSrc = '';
  // Crypto: currency 'IDR' = dihitung dalam Rupiah (Indodax, Pintu…), 'CRYPTO' = dalam USD
  const lv = a.jenis === 'crypto' ? liveMap?.[a.symbol] : null;
  const lvPrice = lv == null ? null : typeof lv === 'number' ? (a.currency === 'IDR' ? null : lv) : (a.currency === 'IDR' ? lv.idr : lv.usd);
  if (lvPrice) { price = lvPrice; priceDate = today(); priceSrc = 'live'; }
  else if (lastPrice && (!lastTxn || lastPrice.tanggal >= lastTxn.tanggal)) { price = Number(lastPrice.harga); priceDate = lastPrice.tanggal; priceSrc = 'manual'; }
  else if (lastTxn) { price = Number(lastTxn.harga); priceDate = lastTxn.tanggal; priceSrc = 'transaksi'; }
  const fx = a.currency === 'IDR' ? 1 : usdIdr;
  const value = units * (price ?? 0);
  return {
    units, cost, avg: units ? cost / units : 0, price, priceDate, priceSrc, value,
    pl: value - cost, plPct: cost ? (value - cost) / cost * 100 : 0, realized,
    valueIdr: value * fx, costIdr: cost * fx, plIdr: (value - cost) * fx, realizedIdr: realized * fx
  };
}

// ---------- Halaman ----------
export default {
  async render(root) {
    el = root;
    el.innerHTML = `
      <header class="page-head">
        <div>
          <p class="eyebrow">Investment</p>
          <h1 class="page-title" id="iv-title">Portofolio</h1>
        </div>
        <div class="date-nav">
          <button class="btn btn-ghost" id="iv-refresh" title="Ambil harga crypto terbaru">🔄 Harga live</button>
          <button class="btn" id="iv-add" data-edit>＋ Aset</button>
        </div>
      </header>
      <div class="grid fn-sum" id="iv-sum"></div>
      <div class="gy-cols">
        <section class="card" id="iv-alloc"></section>
        <section class="card" id="iv-top"></section>
      </div>
      <section class="card" id="iv-list"></section>`;
    el.querySelector('#iv-add').onclick = () => openAsset();
    el.querySelector('#iv-refresh').onclick = () => refreshLive(true);
    await load();
  }
};

async function load() {
  const uid = state.viewing.id;
  const [a, t, p, r] = await Promise.all([
    sb.from('investments').select('*').eq('user_id', uid).order('created_at'),
    fetchAll(() => sb.from('invest_txns').select('*').eq('user_id', uid)),
    fetchAll(() => sb.from('invest_prices').select('*').eq('user_id', uid)),
    getUsdIdr()
  ]);
  if (!el.isConnected) return;   // halaman sudah ditinggal
  if (a.error) return toast('Gagal memuat investasi: ' + a.error.message, 'error');
  assets = a.data; rate = r || 16000;
  txns = new Map(); prices = new Map();
  (t.data || []).forEach(x => { if (!txns.has(x.investment_id)) txns.set(x.investment_id, []); txns.get(x.investment_id).push(x); });
  (p.data || []).forEach(x => { if (!prices.has(x.investment_id)) prices.set(x.investment_id, []); prices.get(x.investment_id).push(x); });
  draw();
  refreshLive(false);
}

// Harga crypto live dari CoinGecko (+ simpan sebagai harga hari ini supaya bisa dilihat saat offline / mode pantau)
async function refreshLive(manual) {
  const ids = [...new Set(assets.filter(a => a.jenis === 'crypto' && a.symbol).map(a => a.symbol))];
  if (!ids.length) { if (manual) toast('Belum ada aset crypto. Harga saham/emas/reksa dana di-update manual lewat detail aset.'); return; }
  const btn = el.querySelector('#iv-refresh');
  btn.disabled = true; btn.textContent = '⏳ Memuat…';
  try {
    live = await getCryptoPrices(ids);
    liveAt = new Date();
    if (!el.isConnected) return;
    if (!state.readOnly) {
      const rows = assets.filter(a => a.jenis === 'crypto' && live[a.symbol])
        .map(a => ({ investment_id: a.id, tanggal: today(), harga: a.currency === 'IDR' ? live[a.symbol].idr : live[a.symbol].usd }))
        .filter(r => r.harga);
      if (rows.length) await sb.from('invest_prices').upsert(rows, { onConflict: 'investment_id,tanggal' });
    }
    draw();
    if (manual) toast('Harga crypto diperbarui');
  } catch (e) {
    if (manual) toast('Gagal mengambil harga crypto (cek koneksi / batas API). Coba lagi sebentar.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = '🔄 Harga live';
  }
}

const posOf = a => position(a, txns.get(a.id), prices.get(a.id), live, rate);

function draw() {
  el.querySelector('#iv-title').textContent = state.readOnly ? `Portofolio ${state.viewing.display_name}` : 'Portofolio';
  const rows = assets.map(a => ({ a, p: posOf(a) }));
  drawSummary(rows); drawAlloc(rows); drawTop(rows); drawList(rows);
}

function drawSummary(rows) {
  const val = rows.reduce((s, r) => s + r.p.valueIdr, 0);
  const cost = rows.reduce((s, r) => s + r.p.costIdr, 0);
  const pl = val - cost, real = rows.reduce((s, r) => s + r.p.realizedIdr, 0);
  const tiles = [
    ['💎', 'Nilai portofolio', fmt(val), '', `<small class="muted">Kurs $1 = Rp ${Math.round(rate).toLocaleString('id-ID')}</small>`],
    ['🧱', 'Total modal', fmt(cost), ''],
    [pl >= 0 ? '📈' : '📉', 'Untung/rugi berjalan', (pl >= 0 ? '+' : '−') + fmt(Math.abs(pl)), pl >= 0 ? 'in' : 'out',
      cost ? `<small class="delta ${pl >= 0 ? 'down' : 'up'}">${pctStr(pl / cost * 100)}</small>` : ''],
    ['✅', 'Untung terealisasi', (real >= 0 ? '+' : '−') + fmt(Math.abs(real)), real >= 0 ? 'in' : 'out', '<small class="muted">dari penjualan</small>']
  ];
  el.querySelector('#iv-sum').innerHTML = tiles.map(([i, l, v, cls, extra], k) => `
    <div class="card tile" style="--i:${k}"><span class="tile-icon">${i}</span><span class="tile-label">${l}</span>
      <span class="tile-value amt-${cls}">${v}</span>${extra || ''}</div>`).join('');
}

function drawAlloc(rows) {
  const by = new Map();
  rows.filter(r => r.p.valueIdr > 0).forEach(r => by.set(r.a.jenis, (by.get(r.a.jenis) || 0) + r.p.valueIdr));
  const list = [...by].sort((a, b) => b[1] - a[1]);
  const total = list.reduce((s, x) => s + x[1], 0), max = list[0]?.[1] || 1;
  el.querySelector('#iv-alloc').innerHTML = `
    <header class="sched-head"><h2>🥧 Alokasi aset</h2></header>
    ${list.length ? `<ul class="bars">${list.map(([j, v]) => `
      <li><div class="bar-row static">
        <span class="bar-label">${JENIS[j].icon} ${JENIS[j].label}</span>
        <span class="bar-val">${fmt(v)} <small class="muted">${Math.round(v / total * 100)}%</small></span>
        <span class="bar-track"><i style="width:${Math.max(2, v / max * 100)}%"></i></span>
      </div></li>`).join('')}</ul>` : '<p class="muted">Alokasi muncul setelah ada aset dengan nilai.</p>'}`;
}

function drawTop(rows) {
  const held = rows.filter(r => r.p.units > 0 && r.p.cost > 0).sort((a, b) => b.p.plPct - a.p.plPct);
  const box = el.querySelector('#iv-top');
  if (!held.length) { box.innerHTML = '<header class="sched-head"><h2>🏅 Performa</h2></header><p class="muted">Belum ada data performa.</p>'; return; }
  const best = held.slice(0, 3), worst = held.length > 3 ? held.slice(Math.max(3, held.length - 2)).reverse() : [];
  const line = r => `<li><button data-aid="${r.a.id}"><span>${JENIS[r.a.jenis].icon} ${esc(r.a.nama)}</span>
    <b class="${r.p.pl >= 0 ? 'amt-in' : 'amt-out'}">${pctStr(r.p.plPct)}</b></button></li>`;
  box.innerHTML = `
    <header class="sched-head"><h2>🏅 Performa</h2></header>
    <p class="muted small">Teratas</p><ul class="perf">${best.map(line).join('')}</ul>
    ${worst.length ? `<p class="muted small">Terbawah</p><ul class="perf">${worst.map(line).join('')}</ul>` : ''}`;
  box.querySelectorAll('[data-aid]').forEach(b => b.onclick = () => openDetail(assets.find(a => a.id === b.dataset.aid)));
}

function drawList(rows) {
  const box = el.querySelector('#iv-list');
  if (!rows.length) {
    box.innerHTML = `<div class="empty"><div class="empty-icon">${persona().mascot}</div>
      <p class="muted">${state.readOnly ? 'Belum ada aset investasi.' : 'Belum ada aset. Tambahkan saham, reksa dana, emas, crypto, atau deposito yang kamu punya.'}</p></div>`;
    return;
  }
  const held = rows.filter(r => r.p.units > 0), sold = rows.filter(r => r.p.units === 0);
  const row = ({ a, p }) => {
    const j = JENIS[a.jenis];
    return `
      <button class="iv-row" data-aid="${a.id}">
        <span class="txn-ic">${j.icon}</span>
        <span class="iv-name"><b>${esc(a.nama)}</b>
          <small class="muted">${[a.symbol && a.jenis !== 'crypto' ? esc(a.symbol.toUpperCase()) : '', a.platform ? esc(a.platform) : '', a.jenis === 'deposito' ? '' : `${fmtUnit(p.units)} ${j.unit}`].filter(Boolean).join(' · ')}</small></span>
        <span class="iv-price"><small class="muted">${a.jenis === 'deposito' ? 'Nominal' : 'Harga'}</small>
          ${p.price != null ? fmtNative(a.jenis === 'deposito' ? p.value : p.price, a.currency === 'IDR' ? 'IDR' : 'USD') : '–'}
          <small class="muted">${p.priceSrc === 'live' ? '🟢 live' : p.priceDate ? relLabel(p.priceDate) : ''}</small></span>
        <span class="iv-val"><b>${fmt(p.valueIdr)}</b>
          ${p.units ? `<small class="${p.pl >= 0 ? 'amt-in' : 'amt-out'}">${p.pl >= 0 ? '+' : '−'}${fmt(Math.abs(p.plIdr))} (${pctStr(p.plPct)})</small>` : `<small class="muted">Terjual · ${p.realizedIdr >= 0 ? '+' : '−'}${fmt(Math.abs(p.realizedIdr))}</small>`}</span>
      </button>`;
  };
  box.innerHTML = `
    <header class="sched-head"><h2>💼 Aset <span class="muted small">${held.length}</span></h2>
      ${liveAt ? `<span class="muted small">Harga crypto ${liveAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>` : ''}</header>
    <div class="iv-list">${held.map(row).join('')}</div>
    ${sold.length ? `<details class="iv-sold"><summary class="muted small">Sudah terjual habis (${sold.length})</summary><div class="iv-list">${sold.map(row).join('')}</div></details>` : ''}`;
  box.querySelectorAll('[data-aid]').forEach(b => b.onclick = () => openDetail(assets.find(a => a.id === b.dataset.aid)));
}

// ---------- Detail aset ----------
function openDetail(a) {
  const p = posOf(a), j = JENIS[a.jenis], cur = a.currency === 'IDR' ? 'IDR' : 'USD';
  const list = [...(txns.get(a.id) || [])].sort((x, y) => y.tanggal.localeCompare(x.tanggal));
  const m = modal({ title: `${j.icon} ${a.nama}` });
  m.body.innerHTML = `
    <div class="stat-grid" style="--c:var(--primary)">
      <div class="stat"><b>${fmt(p.valueIdr)}</b><span>Nilai sekarang</span></div>
      <div class="stat"><b class="${p.pl >= 0 ? 'amt-in' : 'amt-out'}">${p.units ? pctStr(p.plPct) : '–'}</b><span>${p.units ? (p.pl >= 0 ? '+' : '−') + fmt(Math.abs(p.plIdr)) : 'Untung/rugi'}</span></div>
      ${a.jenis === 'deposito' ? '' : `
      <div class="stat"><b>${fmtUnit(p.units)}</b><span>${j.unit} dimiliki</span></div>
      <div class="stat"><b>${p.units ? fmtNative(p.avg, cur) : '–'}</b><span>Harga rata-rata</span></div>`}
    </div>
    <p class="muted small">
      ${j.label}${a.symbol ? ' · ' + esc(a.symbol) : ''}${a.platform ? ' · ' + esc(a.platform) : ''} ·
      Harga ${p.price != null ? fmtNative(p.price, cur) : '–'} (${p.priceSrc === 'live' ? 'live CoinGecko' : p.priceDate ? 'per ' + fmtShort(p.priceDate) : 'belum ada'})
      ${p.realized ? ` · Untung terealisasi ${p.realizedIdr >= 0 ? '+' : '−'}${fmt(Math.abs(p.realizedIdr))}` : ''}
    </p>
    <div class="form-actions" data-edit>
      <button class="btn btn-sm" data-act="beli">＋ Beli / tambah</button>
      ${p.units ? '<button class="btn btn-ghost btn-sm" data-act="jual">➖ Jual</button>' : ''}
      ${a.jenis !== 'crypto' ? `<button class="btn btn-ghost btn-sm" data-act="price">✏️ Update ${a.jenis === 'deposito' ? 'nominal' : 'harga'}</button>` : ''}
      ${p.units && a.jenis !== 'deposito' ? '<button class="btn btn-ghost btn-sm" data-act="modal">⚖️ Samakan modal</button>' : ''}
      <button class="btn btn-ghost btn-sm" data-act="edit">⚙️ Edit aset</button>
    </div>
    <h3 class="sched-list-title">Riwayat transaksi</h3>
    ${list.length ? `<table class="set-table iv-txt"><thead><tr><th>Tanggal</th><th>Tipe</th><th>${a.jenis === 'deposito' ? '' : 'Unit'}</th><th>${a.jenis === 'deposito' ? 'Nominal' : 'Harga'}</th><th></th></tr></thead>
      <tbody>${list.map(t => `<tr>
        <td>${fmtShort(t.tanggal)}</td>
        ${isAdj(t) ? `<td><span class="pill adj">⚖️ Penyesuaian</span></td><td>–</td>
        <td>modal ${Number(t.fee) >= 0 ? '+' : '−'}${fmtNative(Math.abs(Number(t.fee)), cur)}</td>` : `
        <td><span class="pill ${t.tipe}">${t.tipe === 'beli' ? 'Beli' : 'Jual'}</span></td>
        <td>${a.jenis === 'deposito' ? '' : fmtUnit(t.unit)}</td>
        <td>${fmtNative(a.jenis === 'deposito' ? Number(t.harga) * Number(t.unit) : t.harga, cur)}${Number(t.fee) ? `<br><small class="muted">fee ${fmtNative(t.fee, cur)}</small>` : ''}</td>`}
        <td data-edit><button class="icon-btn sm" data-del="${t.id}" title="Hapus">🗑️</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Belum ada transaksi.</p>'}`;

  const act = (k, fn) => m.body.querySelector(`[data-act=${k}]`)?.addEventListener('click', () => { m.close(); fn(); });
  act('beli', () => openTxn(a, 'beli'));
  act('jual', () => openTxn(a, 'jual'));
  act('price', () => openPrice(a));
  act('edit', () => openAsset(a));
  act('modal', () => openAdjust(a));
  m.body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Yakin?'; b.classList.add('danger'); return; }
    try { assertCanEdit(); } catch (e) { return toast(e.message, 'error'); }
    const { error } = await sb.from('invest_txns').delete().eq('id', b.dataset.del);
    if (error) return toast(error.message, 'error');
    txns.set(a.id, (txns.get(a.id) || []).filter(t => t.id !== b.dataset.del));
    m.close(); draw(); openDetail(a);
  });
}

// ---------- Form aset ----------
// ---------- Form beli/jual: pakai NOMINAL (bisa pecahan) atau JUMLAH UNIT ----------
// Crypto, saham US & reksa dana biasanya dibeli per nominal → dapat pecahan unit.
const defaultMode = (jenis, cur) => (cur !== 'IDR' || ['crypto', 'reksadana'].includes(jenis)) ? 'nominal' : 'unit';
const showNum = n => n ? String(+Number(n).toFixed(8)).replace('.', ',') : '';

function tradeForm(box, { jenis, currency, tipe = 'beli', price = null, maxUnits = 0, avg = 0 }) {
  const j = JENIS[jenis], assetCur = currency === 'IDR' ? 'IDR' : 'USD', assetLbl = assetCur === 'IDR' ? 'Rp' : '$';
  let mode = defaultMode(jenis, currency);
  let ncur = assetCur;   // crypto IDR (Indodax/Pintu) → Rupiah, crypto USD / saham US → Dollar
  let curPrice = price;
  const keep = {};

  const render = () => {
    box.querySelectorAll('input').forEach(i => keep[i.name] = i.value);
    const verb = tipe === 'beli' ? 'dibeli' : 'dijual', got = tipe === 'beli' ? 'didapat' : 'dijual';
    box.innerHTML = `
      <div class="seg seg-full trade-mode">
        <button type="button" data-mode="nominal" class="${mode === 'nominal' ? 'active' : ''}">💵 Pakai nominal</button>
        <button type="button" data-mode="unit" class="${mode === 'unit' ? 'active' : ''}">🔢 Pakai jumlah ${j.unit}</button>
      </div>
      ${mode === 'nominal' ? `
        <label class="amt-field"><span>Nominal ${verb}</span>
          <div class="amt-input">
            ${assetCur === 'USD' ? `<select name="ncur" class="ncur">${['IDR', 'USD'].map(c => `<option value="${c}" ${c === ncur ? 'selected' : ''}>${c === 'IDR' ? 'Rp' : '$'}</option>`).join('')}</select>` : '<span>Rp</span>'}
            <input name="nominal" inputmode="decimal" placeholder="${ncur === 'IDR' ? '100.000' : '50'}" value="${keep.nominal || ''}"></div>
          <small class="muted">${ncur === 'IDR' ? 'Bisa ketik singkat: 100rb, 1,5jt · ' : ''}sudah termasuk fee</small></label>
        <div class="row">
          <label><span>Jumlah ${j.unit} ${got} <small class="muted">(opsional)</small></span><input name="unit_n" inputmode="decimal" placeholder="lihat di aplikasi" value="${keep.unit_n || ''}"></label>
          <label><span>Harga per ${j.unit} (${assetLbl}) <small class="muted">(kalau jumlah kosong)</small></span><input name="harga_n" inputmode="decimal" value="${keep.harga_n ?? showNum(curPrice)}"></label>
        </div>
        <p class="muted small">💡 Paling akurat: isi <b>jumlah ${j.unit}</b> yang tertera di aplikasi ${jenis === 'crypto' ? 'exchange' : 'broker'} — harga efektifnya dihitung otomatis.</p>` : `
        <div class="row">
          <label>Jumlah ${j.unit}<input name="unit" inputmode="decimal" placeholder="${tipe === 'jual' && maxUnits ? 'maks ' + fmtUnit(maxUnits) : jenis === 'saham' && assetCur === 'IDR' ? '100 = 1 lot' : '0'}" value="${keep.unit || ''}"></label>
          <label>Harga per ${j.unit} (${assetLbl})<input name="harga" inputmode="decimal" value="${keep.harga ?? showNum(curPrice)}"></label>
          <label><span>Fee (${assetLbl}) <small class="muted">(opsional)</small></span><input name="fee" inputmode="decimal" placeholder="0" value="${keep.fee || ''}"></label>
        </div>`}
      ${tipe === 'jual' && maxUnits ? `<button type="button" class="link-btn" data-all>Jual semua (${fmtUnit(maxUnits)} ${j.unit})</button>` : ''}
      <p class="small trade-prev" id="trade-prev"></p>`;

    box.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; render(); });
    const sel = box.querySelector('.ncur');
    if (sel) sel.onchange = () => { ncur = sel.value; keep.nominal = ''; render(); };
    const nom = box.querySelector('[name=nominal]');
    if (nom) nom.addEventListener('input', () => { if (ncur === 'IDR' && !/[a-z]/i.test(nom.value)) nom.value = fmtInput(parseAmount(nom.value)); });
    box.querySelector('[data-all]')?.addEventListener('click', () => {
      const u = box.querySelector(mode === 'nominal' ? '[name=unit_n]' : '[name=unit]');
      u.value = showNum(maxUnits); preview();
    });
    box.oninput = preview;
    preview();
  };

  const val = n => box.querySelector(`[name=${n}]`)?.value || '';

  // Hasil: { unit, harga (per unit, mata uang aset), fee } · { empty: true } · { error }
  const read = () => {
    if (mode === 'unit') {
      const unit = num(val('unit')), harga = num(val('harga')), fee = num(val('fee'));
      if (!val('unit') && !val('harga')) return { empty: true };
      if (!(unit > 0) || !(harga > 0)) return { error: `Isi jumlah ${j.unit} dan harga` };
      return { unit, harga, fee };
    }
    const N = ncur === 'IDR' ? parseAmount(val('nominal')) : num(val('nominal'));
    if (!val('nominal') && !val('unit_n')) return { empty: true };
    if (!(N > 0)) return { error: 'Isi nominal' };
    const NA = assetCur === ncur ? N : assetCur === 'USD' ? N / rate : N * rate;   // ke mata uang aset
    let unit = num(val('unit_n')), harga = num(val('harga_n'));
    if (unit > 0) harga = NA / unit;
    else if (harga > 0) unit = +(NA / harga).toFixed(8);
    else return { error: `Isi jumlah ${j.unit} ${tipe === 'beli' ? 'yang didapat' : 'yang dijual'} atau harga per ${j.unit}` };
    if (!(unit > 0)) return { error: 'Nominal terlalu kecil' };
    return { unit, harga, fee: 0, nominal: N, ncur };
  };

  const preview = () => {
    const out = box.querySelector('#trade-prev');
    const r = read();
    if (r.empty || r.error) { out.innerHTML = ''; return; }
    const total = r.unit * r.harga + (tipe === 'beli' ? r.fee : -r.fee);
    let s = `≈ <b>${fmtUnit(r.unit)} ${j.unit}</b> @ ${fmtNative(r.harga, assetCur)} · total <b>${fmtNative(total, assetCur)}</b>`;
    if (assetCur === 'USD') s += ` <span class="muted">(≈ Rp ${Math.round(total * rate).toLocaleString('id-ID')})</span>`;
    if (tipe === 'jual' && avg) {
      const g = r.unit * r.harga - r.fee - avg * r.unit;
      s += `<br>Estimasi ${g >= 0 ? 'untung' : 'rugi'}: <b class="${g >= 0 ? 'amt-in' : 'amt-out'}">${fmtNative(Math.abs(g), assetCur)}</b>`;
    }
    if (tipe === 'jual' && maxUnits && r.unit > maxUnits + 1e-9) s += `<br><span class="amt-out">⚠️ Melebihi yang dimiliki (${fmtUnit(maxUnits)} ${j.unit})</span>`;
    out.innerHTML = s;
  };

  render();
  return {
    read,
    setPrice(p) {
      curPrice = p;
      const h = box.querySelector(mode === 'nominal' ? '[name=harga_n]' : '[name=harga]');
      if (h && !h.value) h.value = showNum(p);
      preview();
    }
  };
}

function openAsset(a = null) {
  try { assertCanEdit(); } catch (e) { return toast(e.message, 'error'); }
  let jenis = a?.jenis || 'saham';
  let cur = a?.currency || 'IDR';
  const m = modal({ title: a ? '⚙️ Edit Aset' : '💎 Aset Baru' });

  const render = () => {
    const isCrypto = jenis === 'crypto', isDepo = jenis === 'deposito';
    if (!isCrypto && cur === 'CRYPTO') cur = 'IDR';
    if (isCrypto && cur === 'USD') cur = 'CRYPTO';
    const curLbl = cur === 'IDR' ? 'Rp' : '$';
    m.body.innerHTML = `
      <form class="sched-form" autocomplete="off">
        <div class="field"><span class="field-label">Jenis</span>
          <div class="chips">${Object.entries(JENIS).map(([k, v]) =>
            `<label class="chip"><input type="radio" name="jenis" value="${k}" ${k === jenis ? 'checked' : ''} ${a ? 'disabled' : ''}><span>${v.icon} ${v.label}</span></label>`).join('')}</div></div>
        ${isCrypto ? `
          <label><span>Cari koin <small class="muted">(data CoinGecko)</small></span>
            <input name="coinq" placeholder="Ketik: bitcoin, eth, solana…" value="${esc(a?.nama || '')}"></label>
          <div class="coin-results" id="coin-res"></div>
          <input type="hidden" name="symbol" value="${esc(a?.symbol || '')}">
          <input type="hidden" name="nama" value="${esc(a?.nama || '')}">
          <p class="muted small" id="coin-sel">${a ? `Terpilih: <b>${esc(a.nama)}</b> (${esc(a.symbol)})` : 'Belum memilih koin.'}</p>
          <div class="field"><span class="field-label">Mata uang harga</span>
            <div class="seg seg-full">
              <button type="button" data-cur="IDR" class="${cur === 'IDR' ? 'active' : ''}">🇮🇩 IDR <small>Indodax, Pintu, Tokocrypto</small></button>
              <button type="button" data-cur="CRYPTO" class="${cur === 'CRYPTO' ? 'active' : ''}">🇺🇸 USD <small>Binance, Bybit, dll.</small></button>
            </div>
            ${a && (txns.get(a.id) || []).length && cur !== a.currency ? `<p class="small amt-out" style="margin:6px 0 0">⚠️ ${(txns.get(a.id) || []).length} transaksi akan dikonversi ke ${cur === 'IDR' ? 'Rupiah' : 'Dollar'} pakai kurs hari ini ($1 = Rp ${Math.round(rate).toLocaleString('id-ID')}).</p>` : ''}
          </div>` : `
          <div class="row">
            <label class="grow">Nama<input name="nama" required maxlength="60" value="${esc(a?.nama || '')}"
              placeholder="${{ saham: 'Contoh: Bank Central Asia', reksadana: 'Contoh: Sucorinvest Money Market', emas: 'Contoh: Emas Antam', deposito: 'Contoh: Deposito BCA 6 bulan', obligasi: 'Contoh: ORI025', lainnya: 'Nama aset' }[jenis]}"></label>
            ${isDepo ? '' : `<label>Kode <small class="muted">(opsional)</small><input name="symbol" maxlength="20" value="${esc(a?.symbol || '')}" placeholder="${jenis === 'saham' ? 'BBCA' : ''}"></label>`}
          </div>
          ${['saham', 'reksadana', 'obligasi', 'lainnya'].includes(jenis) ? `
          <div class="field"><span class="field-label">Mata uang</span>
            <div class="seg">${['IDR', 'USD'].map(c => `<button type="button" data-cur="${c}" class="${cur === c ? 'active' : ''}">${c === 'IDR' ? '🇮🇩 IDR' : '🇺🇸 USD'}</button>`).join('')}</div>
          </div>` : ''}`}
        <label><span>Platform <small class="muted">(opsional)</small></span><input name="platform" maxlength="40" value="${esc(a?.platform || '')}" placeholder="Contoh: Ajaib, Bibit, Pintu, Pegadaian"></label>
        ${a ? '' : `
          <fieldset class="first-buy">
            <legend>Pembelian pertama <small class="muted">(opsional, bisa nanti)</small></legend>
            ${isDepo ? `<div class="row"><label class="grow">Nominal (Rp)<input name="harga" inputmode="decimal" placeholder="10.000.000"></label></div>` : '<div id="fb-box"></div>'}
            <label>Tanggal<input type="date" name="tanggal" value="${today()}" max="${today()}"></label>
          </fieldset>`}
        <div class="form-actions">
          <button class="btn" type="submit">💾 Simpan</button>
          ${a ? '<button class="btn btn-ghost danger-text" type="button" data-act="del">🗑️ Hapus aset</button>' : ''}
        </div>
      </form>`;

    const f = m.body.querySelector('form');
    f.querySelectorAll('[name=jenis]').forEach(r => r.onchange = () => { jenis = r.value; render(); });
    f.querySelectorAll('[data-cur]').forEach(b => b.onclick = () => {
      const keepVals = { nama: f.nama?.value, symbol: f.symbol?.value, platform: f.platform.value, sel: f.querySelector('#coin-sel')?.innerHTML };
      cur = b.dataset.cur; render();
      const g = m.body.querySelector('form');
      if (keepVals.nama != null && g.nama) g.nama.value = keepVals.nama;
      if (keepVals.symbol != null && g.symbol) g.symbol.value = keepVals.symbol;
      g.platform.value = keepVals.platform || '';
      if (keepVals.sel && g.querySelector('#coin-sel')) g.querySelector('#coin-sel').innerHTML = keepVals.sel.replace(/ · Rp.*$/, '');
      if (keepVals.symbol && jenis === 'crypto') getCryptoPrices([keepVals.symbol]).then(pr => { const x = pr[keepVals.symbol]; if (x) m.__tf?.setPrice(cur === 'IDR' ? x.idr : x.usd); }).catch(() => {});
    });
    const tf = !a && !isDepo ? tradeForm(f.querySelector('#fb-box'), { jenis, currency: cur, tipe: 'beli' }) : null;
    m.__tf = tf;

    if (isCrypto) {
      let timer;
      f.coinq.oninput = () => {
        clearTimeout(timer);
        const q = f.coinq.value.trim();
        if (q.length < 2) return;
        timer = setTimeout(async () => {
          const box = f.querySelector('#coin-res');
          box.innerHTML = '<span class="muted small">Mencari…</span>';
          try {
            const res = await searchCoins(q);
            box.innerHTML = res.length ? res.map(c => `<button type="button" class="chip-btn" data-id="${esc(c.id)}" data-name="${esc(c.name)}">
              ${c.thumb ? `<img src="${esc(c.thumb)}" alt="" width="16" height="16">` : ''} ${esc(c.name)} <small class="muted">${esc(c.symbol)}</small></button>`).join('')
              : '<span class="muted small">Tidak ditemukan.</span>';
            box.querySelectorAll('[data-id]').forEach(b => b.onclick = () => {
              f.symbol.value = b.dataset.id; f.nama.value = b.dataset.name;
              f.querySelector('#coin-sel').innerHTML = `Terpilih: <b>${esc(b.dataset.name)}</b> (${esc(b.dataset.id)})`;
              box.innerHTML = '';
              // Ambil harga sekarang supaya beli pakai nominal langsung terhitung
              getCryptoPrices([b.dataset.id]).then(pr => {
                const x = pr[b.dataset.id];
                if (!x) return;
                tf?.setPrice(cur === 'IDR' ? x.idr : x.usd);
                f.querySelector('#coin-sel').innerHTML += ` · Rp ${Number(x.idr).toLocaleString('id-ID')} / $${Number(x.usd).toLocaleString('en-US')}`;
              }).catch(() => {});
            });
          } catch { box.innerHTML = '<span class="muted small">Gagal mencari. Cek koneksi lalu coba lagi.</span>'; }
        }, 400);
      };
    }

    f.onsubmit = async e => {
      e.preventDefault();
      const row = {
        jenis, currency: cur,
        nama: (f.nama.value || '').trim(),
        symbol: (f.symbol?.value || '').trim() || null,
        platform: f.platform.value.trim() || null
      };
      if (isCrypto && !row.symbol) return toast('Pilih koin dari hasil pencarian', 'error');
      if (!row.nama) return toast('Isi nama aset', 'error');
      const buy = tf ? tf.read() : null;
      if (buy?.error) return toast('Pembelian pertama: ' + buy.error, 'error');
      const q = a ? sb.from('investments').update(row).eq('id', a.id).select().single()
                  : sb.from('investments').insert(row).select().single();
      const { data, error } = await q;
      if (error) return toast('Gagal menyimpan: ' + error.message, 'error');
      if (a) {
        const old = a.currency, list = txns.get(a.id) || [];
        const oldIdr = old === 'IDR', newIdr = data.currency === 'IDR';
        if (oldIdr !== newIdr && (list.length || (prices.get(a.id) || []).length)) {
          const k = newIdr ? rate : 1 / rate;   // USD→IDR dikali kurs, IDR→USD dibagi kurs
          const res = await Promise.all([
            ...list.map(t => sb.from('invest_txns').update({ harga: Number(t.harga) * k, fee: Number(t.fee || 0) * k }).eq('id', t.id)),
            sb.from('invest_prices').delete().eq('investment_id', a.id)
          ]);
          if (res.some(r => r.error)) toast('Sebagian transaksi gagal dikonversi — cek riwayatnya', 'error');
          list.forEach(t => { t.harga = Number(t.harga) * k; t.fee = Number(t.fee || 0) * k; });
          prices.set(a.id, []);
          toast(`Dikonversi ke ${newIdr ? 'Rupiah' : 'Dollar'} (kurs Rp ${Math.round(rate).toLocaleString('id-ID')})`);
        }
        Object.assign(a, data); m.close(); draw();
        if (a.jenis === 'crypto') refreshLive(false);
        return;
      }

      assets.push(data);
      // Pembelian pertama
      const first = isDepo ? { unit: 1, harga: num(f.harga?.value || ''), fee: 0 } : buy;
      if (first && !first.empty && first.harga > 0 && first.unit > 0) {
        const r = await sb.from('invest_txns').insert({ investment_id: data.id, tipe: 'beli', unit: first.unit, harga: first.harga, fee: first.fee || 0, tanggal: f.tanggal.value }).select().single();
        if (r.error) toast('Aset tersimpan, tapi pembelian gagal: ' + r.error.message, 'error');
        else txns.set(data.id, [r.data]);
      }
      m.close(); draw(); sticker('💎 Aset baru!');
      if (isCrypto) refreshLive(false);
    };

    f.querySelector('[data-act=del]')?.addEventListener('click', async ev => {
      const b = ev.currentTarget;
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = `Yakin? ${txns.get(a.id)?.length || 0} transaksi ikut terhapus`; return; }
      const { error } = await sb.from('investments').delete().eq('id', a.id);
      if (error) return toast(error.message, 'error');
      assets = assets.filter(x => x !== a); txns.delete(a.id); prices.delete(a.id);
      m.close(); toast('Aset dihapus'); draw();
    });
  };
  render();
}

// ---------- Beli / jual ----------
function openTxn(a, tipe) {
  try { assertCanEdit(); } catch (e) { return toast(e.message, 'error'); }
  const p = posOf(a), j = JENIS[a.jenis], isDepo = a.jenis === 'deposito';
  const m = modal({ title: `${tipe === 'beli' ? '＋ Beli' : '➖ Jual'} ${a.nama}` });
  m.body.innerHTML = `
    <form class="sched-form" autocomplete="off">
      ${isDepo ? `<div class="row"><label class="grow">${tipe === 'beli' ? 'Nominal ditambahkan' : 'Nominal cair diterima'} (Rp)<input name="harga" inputmode="decimal" required placeholder="0"></label></div>`
        : '<div id="tx-box"></div>'}
      <label>Tanggal<input type="date" name="tanggal" required value="${today()}" max="${today()}"></label>
      <label><span>Catatan <small class="muted">(opsional)</small></span><input name="catatan" maxlength="120"></label>
      <div class="form-actions"><button class="btn" type="submit">💾 Simpan</button></div>
    </form>`;
  const f = m.body.querySelector('form');
  const tf = isDepo ? null : tradeForm(f.querySelector('#tx-box'), {
    jenis: a.jenis, currency: a.currency, tipe, price: p.price, maxUnits: tipe === 'jual' ? p.units : 0, avg: p.avg
  });
  if (isDepo) f.harga.oninput = () => { if (!/[a-z]/i.test(f.harga.value)) f.harga.value = fmtInput(parseAmount(f.harga.value)); };

  f.onsubmit = async e => {
    e.preventDefault();
    let r;
    if (isDepo) {
      const v = parseAmount(f.harga.value);
      if (!(v > 0)) return toast('Isi nominal', 'error');
      // Deposito cair: jual seluruh posisi dengan nominal yang diterima
      r = tipe === 'jual' ? { unit: p.units || 1, harga: v / (p.units || 1), fee: 0 } : { unit: 1, harga: v, fee: 0 };
    } else {
      r = tf.read();
      if (r.empty) return toast('Isi nominal atau jumlah unit', 'error');
      if (r.error) return toast(r.error, 'error');
      if (tipe === 'jual' && r.unit > p.units + 1e-9) return toast(`Maksimal ${fmtUnit(p.units)} ${j.unit}`, 'error');
      if (tipe === 'jual' && Math.abs(r.unit - p.units) < 1e-8) r.unit = p.units;   // jual semua → pas habis
    }
    const row = { investment_id: a.id, tipe, unit: r.unit, harga: r.harga, fee: r.fee || 0, tanggal: f.tanggal.value, catatan: f.catatan.value.trim() || null };
    const { data, error } = await sb.from('invest_txns').insert(row).select().single();
    if (error) return toast('Gagal menyimpan: ' + error.message, 'error');
    txns.set(a.id, [...(txns.get(a.id) || []), data]);
    m.close(); draw();
    if (tipe === 'jual') {
      const gain = row.unit * row.harga - row.fee - p.avg * row.unit;
      gain > 0 ? (celebrate(), setTimeout(() => sticker('💰 Cuan terealisasi!'), 600)) : toast('Penjualan tercatat');
    } else sticker();
  };
}

// ---------- Samakan modal dengan exchange (Indodax, Pintu, broker…) ----------
// Disimpan sebagai transaksi "beli 0 unit" dengan fee = selisih modal → jumlah koin tetap,
// hanya modal (& harga rata-rata) yang bergeser. Bisa dihapus dari riwayat kapan saja.
const ADJ_NOTE = '⚖️ Penyesuaian modal';
const isAdj = t => Number(t.unit) === 0 && String(t.catatan || '').startsWith('⚖️');
const signedNum = s => { s = String(s).trim(); const neg = /^[-−–]/.test(s) || /^\(.*\)$/.test(s); const v = num(s.replace(/^[-−–+]|[()%]/g, '')); return neg ? -v : v; };

function openAdjust(a) {
  try { assertCanEdit(); } catch (e) { return toast(e.message, 'error'); }
  const p = posOf(a), j = JENIS[a.jenis], cur = a.currency === 'IDR' ? 'IDR' : 'USD', lbl = cur === 'IDR' ? 'Rp' : '$';
  const show = n => fmtNative(n, cur);
  const v0 = n => String(Math.round(n * (cur === 'IDR' ? 1 : 100)) / (cur === 'IDR' ? 1 : 100)).replace('.', ',');
  let mode = 'pl';
  const m = modal({ title: `⚖️ Samakan modal · ${a.nama}` });
  m.body.innerHTML = `
    <form class="sched-form adj-form" autocomplete="off">
      <p class="muted small">Isi angka dari aplikasi ${esc(a.platform || 'exchange')} kamu. Jumlah ${j.unit} tidak berubah — hanya <b>modal</b> & <b>harga rata-rata</b> yang disesuaikan.</p>
      <div class="seg adj-seg">
        <button type="button" data-m="pl" class="active">Dari Unrealized P&L</button>
        <button type="button" data-m="avg">Dari harga rata-rata</button>
        <button type="button" data-m="cost">Dari total modal</button>
      </div>
      <div id="adj-in"></div>
      <div class="adj-prev" id="adj-prev"></div>
      <div class="form-actions"><button class="btn" type="submit">⚖️ Samakan</button></div>
    </form>`;
  const f = m.body.querySelector('form'), box = f.querySelector('#adj-in'), prev = f.querySelector('#adj-prev');
  const fields = () => {
    box.innerHTML = mode === 'pl' ? `
      <div class="row">
        <label class="grow">Nilai aset di exchange (${lbl})<input name="nilai" inputmode="decimal" value="${v0(p.value)}"></label>
        <label class="grow">Unrealized P&L (${lbl})<input name="pl" inputmode="decimal" placeholder="contoh: -9.995.307"></label>
      </div>
      <p class="muted small">Tulis tanda minus kalau rugi. Modal = nilai − P&L.</p>`
      : mode === 'avg' ? `<label>Harga rata-rata per ${j.unit} (${lbl})<input name="avg" inputmode="decimal" placeholder="${v0(p.avg)}"></label>`
      : `<label>Total modal (${lbl})<input name="cost" inputmode="decimal" placeholder="${v0(p.cost)}"></label>`;
    box.querySelectorAll('input').forEach(i => i.oninput = calc);
    (box.querySelector('[name=pl],[name=avg],[name=cost]'))?.focus();
    calc();
  };
  const target = () => {
    if (mode === 'pl') {
      const pl = f.pl.value.trim(); if (!pl) return null;
      const nilai = num(f.nilai.value); if (!(nilai > 0)) return null;
      return nilai - signedNum(pl);
    }
    if (mode === 'avg') { const v = num(f.avg.value); return v > 0 ? v * p.units : null; }
    const v = num(f.cost.value); return v > 0 ? v : null;
  };
  function calc() {
    const c = target();
    if (c == null) { prev.innerHTML = `<span class="muted">Modal sekarang di app: <b>${show(p.cost)}</b> · rata-rata ${show(p.avg)}</span>`; return; }
    if (!(c > 0)) { prev.innerHTML = '<span class="amt-out">Modal hasil hitungan tidak masuk akal — cek lagi angkanya.</span>'; return; }
    const pl = p.value - c, d = c - p.cost;
    prev.innerHTML = `
      <div class="adj-row"><span>Modal</span><b>${show(p.cost)} → ${show(c)}</b></div>
      <div class="adj-row"><span>Harga rata-rata</span><b>${show(p.avg)} → ${show(c / p.units)}</b></div>
      <div class="adj-row"><span>Unrealized P&L (harga ${p.priceSrc === 'live' ? 'live' : 'terakhir'})</span>
        <b class="${pl >= 0 ? 'amt-in' : 'amt-out'}">${pl >= 0 ? '+' : '−'}${show(Math.abs(pl))} (${pctStr(pl / c * 100)})</b></div>
      <p class="muted small">Selisih modal ${d >= 0 ? '+' : '−'}${show(Math.abs(d))} dicatat sebagai "Penyesuaian modal".</p>`;
  }
  f.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    mode = b.dataset.m; f.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('active', x === b)); fields();
  });
  fields();
  f.onsubmit = async e => {
    e.preventDefault();
    const c = target();
    if (!(c > 0)) return toast('Isi angkanya dulu', 'error');
    const delta = Math.round((c - p.cost) * 100) / 100;
    if (Math.abs(delta) < 0.01) { m.close(); return toast('Modal sudah sama 👍'); }
    const row = { investment_id: a.id, tipe: 'beli', unit: 0, harga: p.price ?? p.avg ?? 0, fee: delta, tanggal: today(), catatan: ADJ_NOTE };
    const { data, error } = await sb.from('invest_txns').insert(row).select().single();
    if (error) return toast('Gagal menyimpan: ' + error.message, 'error');
    txns.set(a.id, [...(txns.get(a.id) || []), data]);
    m.close(); draw(); sticker('⚖️ Modal disamakan!');
  };
}

// ---------- Update harga manual ----------
function openPrice(a) {
  try { assertCanEdit(); } catch (e) { return toast(e.message, 'error'); }
  const p = posOf(a), isDepo = a.jenis === 'deposito', curLbl = a.currency === 'IDR' ? 'Rp' : '$';
  const m = modal({ title: `✏️ Update ${isDepo ? 'nominal' : 'harga'} · ${a.nama}` });
  m.body.innerHTML = `
    <form class="sched-form" autocomplete="off">
      <p class="muted small">${isDepo ? 'Isi nilai deposito saat ini (pokok + bunga yang sudah berjalan).' : `Masukkan harga terbaru per ${JENIS[a.jenis].unit} — cek di aplikasi ${esc(a.platform || 'broker/platform')} kamu.`}</p>
      <div class="row">
        <label class="grow">${isDepo ? 'Nominal sekarang' : 'Harga terbaru'} (${curLbl})<input name="harga" inputmode="decimal" required
          value="${p.price != null ? String(+(isDepo ? p.value : Number(p.price)).toFixed(8)).replace('.', ',') : ''}"></label>
        <label>Tanggal<input type="date" name="tanggal" required value="${today()}" max="${today()}"></label>
      </div>
      <div class="form-actions"><button class="btn" type="submit">💾 Simpan</button></div>
    </form>`;
  const f = m.body.querySelector('form');
  f.harga.select();
  f.onsubmit = async e => {
    e.preventDefault();
    let harga = num(f.harga.value);
    if (!(harga > 0)) return toast('Isi angka yang valid', 'error');
    if (isDepo && p.units) harga = harga / p.units;
    const { data, error } = await sb.from('invest_prices')
      .upsert({ investment_id: a.id, tanggal: f.tanggal.value, harga }, { onConflict: 'investment_id,tanggal' }).select().single();
    if (error) return toast('Gagal menyimpan: ' + error.message, 'error');
    prices.set(a.id, [...(prices.get(a.id) || []).filter(x => x.tanggal !== data.tanggal), data]);
    m.close(); draw(); toast('Harga diperbarui');
  };
}
