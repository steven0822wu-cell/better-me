import { sb } from '../supabase.js';
import { state, assertCanEdit } from '../state.js';
import { toast, esc, modal } from '../ui.js';
import { sticker, celebrate, persona } from '../fx.js';
import { fetchAll } from '../db.js';
import { money, getUsdIdr, getCryptoUsd, searchCoins } from '../currency.js';
import { today, fmtShort, relLabel } from '../date.js';

export const JENIS = {
  saham:     { icon: '📊', label: 'Saham',      unit: 'lembar', cur: 'IDR' },
  reksadana: { icon: '🧺', label: 'Reksa Dana', unit: 'unit',   cur: 'IDR' },
  emas:      { icon: '🪙', label: 'Emas',       unit: 'gram',   cur: 'IDR' },
  crypto:    { icon: '₿',  label: 'Crypto',     unit: 'koin',   cur: 'CRYPTO' },
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
  if (a.currency === 'CRYPTO' && liveMap?.[a.symbol]) { price = liveMap[a.symbol]; priceDate = today(); priceSrc = 'live'; }
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
  const ids = [...new Set(assets.filter(a => a.currency === 'CRYPTO' && a.symbol).map(a => a.symbol))];
  if (!ids.length) { if (manual) toast('Belum ada aset crypto. Harga saham/emas/reksa dana di-update manual lewat detail aset.'); return; }
  const btn = el.querySelector('#iv-refresh');
  btn.disabled = true; btn.textContent = '⏳ Memuat…';
  try {
    live = await getCryptoUsd(ids);
    liveAt = new Date();
    if (!el.isConnected) return;
    if (!state.readOnly) {
      const rows = assets.filter(a => a.currency === 'CRYPTO' && live[a.symbol])
        .map(a => ({ investment_id: a.id, tanggal: today(), harga: live[a.symbol] }));
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
      ${a.currency !== 'CRYPTO' ? `<button class="btn btn-ghost btn-sm" data-act="price">✏️ Update ${a.jenis === 'deposito' ? 'nominal' : 'harga'}</button>` : ''}
      <button class="btn btn-ghost btn-sm" data-act="edit">⚙️ Edit aset</button>
    </div>
    <h3 class="sched-list-title">Riwayat transaksi</h3>
    ${list.length ? `<table class="set-table iv-txt"><thead><tr><th>Tanggal</th><th>Tipe</th><th>${a.jenis === 'deposito' ? '' : 'Unit'}</th><th>${a.jenis === 'deposito' ? 'Nominal' : 'Harga'}</th><th></th></tr></thead>
      <tbody>${list.map(t => `<tr>
        <td>${fmtShort(t.tanggal)}</td>
        <td><span class="pill ${t.tipe}">${t.tipe === 'beli' ? 'Beli' : 'Jual'}</span></td>
        <td>${a.jenis === 'deposito' ? '' : fmtUnit(t.unit)}</td>
        <td>${fmtNative(a.jenis === 'deposito' ? Number(t.harga) * Number(t.unit) : t.harga, cur)}${Number(t.fee) ? `<br><small class="muted">fee ${fmtNative(t.fee, cur)}</small>` : ''}</td>
        <td data-edit><button class="icon-btn sm" data-del="${t.id}" title="Hapus">🗑️</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Belum ada transaksi.</p>'}`;

  const act = (k, fn) => m.body.querySelector(`[data-act=${k}]`)?.addEventListener('click', () => { m.close(); fn(); });
  act('beli', () => openTxn(a, 'beli'));
  act('jual', () => openTxn(a, 'jual'));
  act('price', () => openPrice(a));
  act('edit', () => openAsset(a));
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
function openAsset(a = null) {
  try { assertCanEdit(); } catch (e) { return toast(e.message, 'error'); }
  let jenis = a?.jenis || 'saham';
  let cur = a?.currency || 'IDR';
  const m = modal({ title: a ? '⚙️ Edit Aset' : '💎 Aset Baru' });

  const render = () => {
    const isCrypto = jenis === 'crypto', isDepo = jenis === 'deposito';
    if (isCrypto) cur = 'CRYPTO'; else if (cur === 'CRYPTO') cur = 'IDR';
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
          <p class="muted small" id="coin-sel">${a ? `Terpilih: <b>${esc(a.nama)}</b> (${esc(a.symbol)})` : 'Belum memilih koin.'}</p>` : `
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
            <div class="row">
              ${isDepo ? `<label class="grow">Nominal (Rp)<input name="harga" inputmode="decimal" placeholder="10.000.000"></label>` : `
              <label>Jumlah ${JENIS[jenis].unit}<input name="unit" inputmode="decimal" placeholder="${jenis === 'saham' ? '100 = 1 lot' : '0'}"></label>
              <label>Harga per ${JENIS[jenis].unit} (${curLbl})<input name="harga" inputmode="decimal" placeholder="0"></label>`}
              <label>Tanggal<input type="date" name="tanggal" value="${today()}" max="${today()}"></label>
            </div>
          </fieldset>`}
        <div class="form-actions">
          <button class="btn" type="submit">💾 Simpan</button>
          ${a ? '<button class="btn btn-ghost danger-text" type="button" data-act="del">🗑️ Hapus aset</button>' : ''}
        </div>
      </form>`;

    const f = m.body.querySelector('form');
    f.querySelectorAll('[name=jenis]').forEach(r => r.onchange = () => { jenis = r.value; render(); });
    f.querySelectorAll('[data-cur]').forEach(b => b.onclick = () => { cur = b.dataset.cur; render(); });

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
      const q = a ? sb.from('investments').update(row).eq('id', a.id).select().single()
                  : sb.from('investments').insert(row).select().single();
      const { data, error } = await q;
      if (error) return toast('Gagal menyimpan: ' + error.message, 'error');
      if (a) { Object.assign(a, data); m.close(); draw(); return; }

      assets.push(data);
      // Pembelian pertama
      const harga = num(f.harga?.value || ''), unit = isDepo ? 1 : num(f.unit?.value || '');
      if (harga > 0 && unit > 0) {
        const r = await sb.from('invest_txns').insert({ investment_id: data.id, tipe: 'beli', unit, harga, tanggal: f.tanggal.value }).select().single();
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
  const curLbl = a.currency === 'IDR' ? 'Rp' : '$';
  const m = modal({ title: `${tipe === 'beli' ? '＋ Beli' : '➖ Jual'} ${a.nama}` });
  m.body.innerHTML = `
    <form class="sched-form" autocomplete="off">
      <div class="row">
        ${isDepo ? `<label class="grow">Nominal (Rp)<input name="harga" inputmode="decimal" required placeholder="0"></label>` : `
        <label>Jumlah ${j.unit}<input name="unit" inputmode="decimal" required placeholder="${tipe === 'jual' ? 'maks ' + fmtUnit(p.units) : '0'}"></label>
        <label>Harga per ${j.unit} (${curLbl})<input name="harga" inputmode="decimal" required value="${p.price != null ? String(+Number(p.price).toFixed(8)).replace('.', ',') : ''}"></label>`}
      </div>
      <div class="row">
        <label>Fee (${curLbl}) <small class="muted">(opsional)</small><input name="fee" inputmode="decimal" placeholder="0"></label>
        <label>Tanggal<input type="date" name="tanggal" required value="${today()}" max="${today()}"></label>
      </div>
      ${tipe === 'jual' && !isDepo ? `<button type="button" class="link-btn" data-act="all">Jual semua (${fmtUnit(p.units)} ${j.unit})</button>` : ''}
      <p class="muted small" id="tx-prev"></p>
      <label><span>Catatan <small class="muted">(opsional)</small></span><input name="catatan" maxlength="120"></label>
      <div class="form-actions"><button class="btn" type="submit">💾 Simpan</button></div>
    </form>`;
  const f = m.body.querySelector('form'), prev = f.querySelector('#tx-prev');
  const calc = () => {
    const u = isDepo ? 1 : num(f.unit.value), h = num(f.harga.value), fee = num(f.fee.value);
    if (!u || !h) { prev.textContent = ''; return; }
    const total = u * h + (tipe === 'beli' ? fee : -fee);
    let s = `Total ${tipe === 'beli' ? 'bayar' : 'diterima'}: <b>${fmtNative(total, a.currency === 'IDR' ? 'IDR' : 'USD')}</b>`;
    if (tipe === 'jual' && p.units) s += ` · estimasi ${u * h - fee - p.avg * u >= 0 ? 'untung' : 'rugi'} <b>${fmtNative(Math.abs(u * h - fee - p.avg * u), a.currency === 'IDR' ? 'IDR' : 'USD')}</b>`;
    prev.innerHTML = s;
  };
  f.oninput = calc; calc();
  f.querySelector('[data-act=all]')?.addEventListener('click', () => { f.unit.value = String(p.units).replace('.', ','); calc(); });

  f.onsubmit = async e => {
    e.preventDefault();
    const unit = isDepo ? 1 : num(f.unit.value), harga = num(f.harga.value), fee = num(f.fee.value);
    if (!(unit > 0) || !(harga > 0)) return toast('Isi jumlah dan harga yang valid', 'error');
    if (tipe === 'jual' && !isDepo && unit > p.units + 1e-9) return toast(`Maksimal ${fmtUnit(p.units)} ${j.unit}`, 'error');
    const row = { investment_id: a.id, tipe, unit: isDepo && tipe === 'jual' ? 1 : unit, harga, fee, tanggal: f.tanggal.value, catatan: f.catatan.value.trim() || null };
    // Deposito cair: jual seluruh posisi dengan nominal yang diterima
    if (isDepo && tipe === 'jual') { row.unit = p.units || 1; row.harga = harga / row.unit; }
    const { data, error } = await sb.from('invest_txns').insert(row).select().single();
    if (error) return toast('Gagal menyimpan: ' + error.message, 'error');
    txns.set(a.id, [...(txns.get(a.id) || []), data]);
    m.close(); draw();
    if (tipe === 'jual') {
      const gain = row.unit * row.harga - fee - p.avg * row.unit;
      gain > 0 ? (celebrate(), setTimeout(() => sticker('💰 Cuan terealisasi!'), 600)) : toast('Penjualan tercatat');
    } else sticker();
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
