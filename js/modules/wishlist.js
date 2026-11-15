import { sb } from '../supabase.js';
import { state, assertCanEdit } from '../state.js';
import { toast, esc, modal } from '../ui.js';
import { sticker, celebrate, persona } from '../fx.js';
import { money } from '../currency.js';
import { today } from '../date.js';
import { parseAmount, fmtInput, ACC_TYPES } from './finance.js';

export const PRIO = {
  1: { icon: '🔥', label: 'Wajib' },
  2: { icon: '⭐', label: 'Ingin' },
  3: { icon: '💭', label: 'Suatu saat' }
};

let el, items = [], tab = 'aktif', sort = 'prio';
const fmt = n => money(n, state.me?.currency_view);
const pct = w => Number(w.harga_idr) ? Math.min(100, Number(w.dana_terkumpul) / Number(w.harga_idr) * 100) : 0;
const kurang = w => Math.max(0, Number(w.harga_idr) - Number(w.dana_terkumpul));
const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

export default {
  async render(root) {
    el = root;
    el.innerHTML = `
      <header class="page-head">
        <div>
          <p class="eyebrow">Wishlist</p>
          <h1 class="page-title" id="ws-title">Wishlist</h1>
        </div>
        <button class="btn" id="ws-add" data-edit>＋ Wishlist</button>
      </header>
      <div class="grid fn-sum" id="ws-sum"></div>
      <div class="ws-bar">
        <div class="seg" id="ws-tabs"></div>
        <label class="ws-sort">Urutkan
          <select id="ws-sort" data-allow-ro>
            <option value="prio">Prioritas</option>
            <option value="progress">Paling dekat tercapai</option>
            <option value="harga">Harga termurah</option>
            <option value="baru">Terbaru</option>
          </select></label>
      </div>
      <div class="ws-grid" id="ws-list"></div>`;
    el.querySelector('#ws-add').onclick = () => openForm();
    el.querySelector('#ws-sort').onchange = e => { sort = e.target.value; drawList(); };
    el.querySelector('#ws-list').onclick = onClick;
    await load();
  }
};

async function load() {
  const { data, error } = await sb.from('wishlist').select('*').eq('user_id', state.viewing.id).order('created_at', { ascending: false });
  if (!el.isConnected) return;   // halaman sudah ditinggal
  if (error) return toast('Gagal memuat wishlist: ' + error.message, 'error');
  items = data;
  draw();
}

function draw() {
  el.querySelector('#ws-title').textContent = state.readOnly ? `Wishlist ${state.viewing.display_name}` : 'Wishlist';
  el.querySelector('#ws-sort').value = sort;
  drawSummary(); drawTabs(); drawList();
}

function drawSummary() {
  const act = items.filter(w => w.status !== 'terbeli'), done = items.filter(w => w.status === 'terbeli');
  const total = act.reduce((s, w) => s + Number(w.harga_idr), 0);
  const saved = act.reduce((s, w) => s + Math.min(Number(w.dana_terkumpul), Number(w.harga_idr)), 0);
  const ready = act.filter(w => Number(w.harga_idr) && Number(w.dana_terkumpul) >= Number(w.harga_idr)).length;
  const tiles = [
    ['🎁', 'Total wishlist', fmt(total), `<small class="muted">${act.length} barang</small>`],
    ['🐷', 'Dana terkumpul', fmt(saved), total ? `<div class="progress progress-sm"><i style="width:${saved / total * 100}%"></i></div>` : ''],
    ['🎯', 'Kurang', fmt(Math.max(0, total - saved)), ready ? `<small class="amt-in">✓ ${ready} siap dibeli</small>` : ''],
    ['🛍️', 'Sudah terbeli', done.length, `<small class="muted">${fmt(done.reduce((s, w) => s + Number(w.harga_idr), 0))}</small>`]
  ];
  el.querySelector('#ws-sum').innerHTML = tiles.map(([i, l, v, extra], k) => `
    <div class="card tile" style="--i:${k}"><span class="tile-icon">${i}</span><span class="tile-label">${l}</span>
      <span class="tile-value">${v}</span>${extra}</div>`).join('');
}

function drawTabs() {
  const nA = items.filter(w => w.status !== 'terbeli').length, nB = items.length - nA;
  const box = el.querySelector('#ws-tabs');
  box.innerHTML = `<button class="${tab === 'aktif' ? 'active' : ''}" data-tab="aktif">🎁 Impian (${nA})</button>
    <button class="${tab === 'terbeli' ? 'active' : ''}" data-tab="terbeli">🛍️ Terbeli (${nB})</button>`;
  box.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; drawTabs(); drawList(); });
}

function drawList() {
  let list = items.filter(w => tab === 'terbeli' ? w.status === 'terbeli' : w.status !== 'terbeli');
  const by = {
    prio: (a, b) => a.prioritas - b.prioritas || pct(b) - pct(a),
    progress: (a, b) => pct(b) - pct(a) || kurang(a) - kurang(b),
    harga: (a, b) => Number(a.harga_idr) - Number(b.harga_idr),
    baru: (a, b) => String(b.created_at).localeCompare(String(a.created_at))
  };
  list.sort(by[sort]);
  const box = el.querySelector('#ws-list');
  if (!list.length) {
    box.innerHTML = `<div class="card empty ws-empty"><div class="empty-icon">${tab === 'terbeli' ? '🛍️' : persona().mascot}</div>
      <p class="muted">${tab === 'terbeli' ? 'Belum ada yang terbeli. Semangat nabungnya!' :
        state.readOnly ? 'Wishlist masih kosong.' : 'Wishlist masih kosong. Tulis barang impianmu — yang ditulis lebih gampang dicapai!'}</p></div>`;
    return;
  }
  box.innerHTML = list.map((w, i) => card(w, i)).join('');
  box.querySelectorAll('.ws-img img').forEach(img => img.onerror = () => img.closest('.ws-img').classList.add('noimg'));
}

function card(w, i) {
  const p = pct(w), bought = w.status === 'terbeli', full = !bought && Number(w.harga_idr) && p >= 100;
  const img = safeUrl(w.gambar_url), link = safeUrl(w.link);
  return `
    <article class="card ws-card ${bought ? 'bought' : ''} ${full ? 'full' : ''}" data-id="${w.id}" style="--i:${i}">
      <div class="ws-img ${img ? '' : 'noimg'}">
        ${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
        <span class="ws-ph">${esc((w.nama || '?').trim().charAt(0).toUpperCase())}</span>
        <span class="ws-prio p${w.prioritas}">${PRIO[w.prioritas].icon} ${PRIO[w.prioritas].label}</span>
        ${bought ? '<span class="ws-stamp">TERBELI ✓</span>' : full ? '<span class="ws-stamp ready">SIAP DIBELI 🎉</span>' : ''}
      </div>
      <div class="ws-body">
        <button class="ws-name" data-act="edit" ${state.readOnly ? 'disabled' : ''}>${esc(w.nama)}</button>
        <div class="ws-price">${fmt(Number(w.harga_idr))}</div>
        ${bought ? `<small class="muted">Impian tercapai 🎉</small>` : `
          <div class="progress"><i style="width:${p}%"></i></div>
          <div class="ws-meta"><span><b>${fmt(Number(w.dana_terkumpul))}</b> terkumpul</span><span>${Math.floor(p)}%</span></div>
          ${!full && Number(w.harga_idr) ? `<small class="muted">Kurang ${fmt(kurang(w))}</small>` : ''}`}
        ${link ? `<a class="ws-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(hostOf(link))}</a>` : ''}
        <div class="ws-actions" data-edit>
          ${bought ? '<button class="btn btn-ghost btn-sm" data-act="undo">↩️ Batal terbeli</button>' : `
            <button class="btn btn-ghost btn-sm" data-act="save">🐷 Tabung</button>
            <button class="btn btn-sm ${full ? '' : 'btn-ghost'}" data-act="buy">🛒 Beli</button>`}
        </div>
      </div>
    </article>`;
}

async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const w = items.find(x => x.id === b.closest('[data-id]')?.dataset.id);
  if (!w) return;
  try { assertCanEdit(); } catch (err) { return toast(err.message, 'error'); }
  if (b.dataset.act === 'edit') return openForm(w);
  if (b.dataset.act === 'save') return openSave(w);
  if (b.dataset.act === 'buy') return openBuy(w);
  if (b.dataset.act === 'undo') return undoBuy(w);
}

async function patch(w, row) {
  const { data, error } = await sb.from('wishlist').update(row).eq('id', w.id).select().single();
  if (error) { toast('Gagal menyimpan: ' + error.message, 'error'); return false; }
  Object.assign(w, data);
  return true;
}

// ---------- Tambah / edit ----------
function openForm(w = null) {
  try { assertCanEdit(); } catch (err) { return toast(err.message, 'error'); }
  const m = modal({ title: w ? '✏️ Edit Wishlist' : '🎁 Wishlist Baru' });
  m.body.innerHTML = `
    <form class="sched-form" autocomplete="off">
      <label>Nama barang / impian<input name="nama" required maxlength="80" placeholder="Contoh: iPad Air, Liburan Jepang, Sepatu lari" value="${esc(w?.nama || '')}"></label>
      <div class="row">
        <label class="amt-field grow"><span>Perkiraan harga</span>
          <div class="amt-input"><span>Rp</span><input name="harga" inputmode="decimal" required placeholder="0" value="${w ? fmtInput(Number(w.harga_idr)) : ''}"></div>
          <small class="muted">Bisa ketik singkat: 750rb, 12jt</small></label>
        ${w ? '' : `<label class="amt-field grow"><span>Dana yang sudah ada <small class="muted">(opsional)</small></span>
          <div class="amt-input"><span>Rp</span><input name="dana" inputmode="decimal" placeholder="0"></div></label>`}
      </div>
      <div class="field"><span class="field-label">Prioritas</span>
        <div class="chips">${[1, 2, 3].map(p => `<label class="chip"><input type="radio" name="prio" value="${p}" ${(w?.prioritas || 2) === p ? 'checked' : ''}><span>${PRIO[p].icon} ${PRIO[p].label}</span></label>`).join('')}</div></div>
      <label><span>Link produk <small class="muted">(opsional)</small></span><input name="link" type="url" placeholder="https://…" value="${esc(w?.link || '')}"></label>
      <label><span>Link gambar <small class="muted">(opsional — klik kanan gambar produk → Copy image address)</small></span>
        <input name="gambar" type="url" placeholder="https://…jpg" value="${esc(w?.gambar_url || '')}"></label>
      <div class="ws-preview" ${w?.gambar_url ? '' : 'hidden'}><img alt="Pratinjau" referrerpolicy="no-referrer" src="${esc(safeUrl(w?.gambar_url))}"></div>
      <div class="form-actions">
        <button class="btn" type="submit">💾 Simpan</button>
        ${w ? '<button class="btn btn-ghost danger-text" type="button" data-act="del">🗑️ Hapus</button>' : ''}
      </div>
    </form>`;
  const f = m.body.querySelector('form');
  const money1 = i => i && (i.oninput = () => { if (!/[a-z]/i.test(i.value)) i.value = fmtInput(parseAmount(i.value)); });
  money1(f.harga); money1(f.dana);
  const pv = f.querySelector('.ws-preview');
  f.gambar.oninput = () => {
    const u = safeUrl(f.gambar.value.trim());
    pv.hidden = !u;
    if (u) pv.querySelector('img').src = u;
  };
  pv.querySelector('img').onerror = () => { if (f.gambar.value) pv.hidden = true; };

  f.onsubmit = async e => {
    e.preventDefault();
    const harga = parseAmount(f.harga.value);
    if (!harga) return toast('Isi perkiraan harga', 'error');
    const row = {
      nama: f.nama.value.trim(), harga_idr: harga, prioritas: Number(f.prio.value),
      link: safeUrl(f.link.value.trim()) || null, gambar_url: safeUrl(f.gambar.value.trim()) || null
    };
    if (!w) {
      row.dana_terkumpul = parseAmount(f.dana?.value || '');
      row.status = row.dana_terkumpul > 0 ? 'nabung' : 'wish';
    }
    if (w) {
      if (!(await patch(w, row))) return;
    } else {
      const { data, error } = await sb.from('wishlist').insert(row).select().single();
      if (error) return toast('Gagal menyimpan: ' + error.message, 'error');
      items.unshift(data);
      sticker('🎁 Impian dicatat!');
    }
    m.close(); tab = 'aktif'; draw();
  };
  f.querySelector('[data-act=del]')?.addEventListener('click', async ev => {
    const b = ev.currentTarget;
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Klik lagi untuk hapus'; return; }
    const { error } = await sb.from('wishlist').delete().eq('id', w.id);
    if (error) return toast(error.message, 'error');
    items = items.filter(x => x !== w); m.close(); toast('Wishlist dihapus'); draw();
  });
}

// ---------- Tabung ----------
function openSave(w) {
  const m = modal({ title: `🐷 Tabung · ${w.nama}` });
  const k = kurang(w);
  const quick = [50000, 100000, 250000, 500000, 1000000].filter(v => v < k || !k);
  m.body.innerHTML = `
    <form class="sched-form" autocomplete="off">
      <p class="muted small">Terkumpul ${fmt(Number(w.dana_terkumpul))} dari ${fmt(Number(w.harga_idr))}${k ? ` · kurang <b>${fmt(k)}</b>` : ''}</p>
      <div class="seg seg-full"><button type="button" class="active" data-m="add">＋ Tambah dana</button><button type="button" data-m="take">－ Ambil kembali</button></div>
      <label class="amt-field"><span>Jumlah</span>
        <div class="amt-input"><span>Rp</span><input name="jumlah" inputmode="decimal" required placeholder="0"></div></label>
      <div class="suggest" style="justify-content:flex-start">
        ${quick.map(v => `<button type="button" class="chip-btn" data-q="${v}">${fmt(v)}</button>`).join('')}
        ${k ? `<button type="button" class="chip-btn" data-q="${k}">Lunasi ${fmt(k)}</button>` : ''}
      </div>
      <div class="form-actions" style="margin-top:14px"><button class="btn" type="submit">💾 Simpan</button></div>
    </form>`;
  const f = m.body.querySelector('form');
  let mode = 'add';
  f.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    mode = b.dataset.m; f.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('active', x === b));
  });
  f.jumlah.oninput = () => { if (!/[a-z]/i.test(f.jumlah.value)) f.jumlah.value = fmtInput(parseAmount(f.jumlah.value)); };
  f.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { f.jumlah.value = fmtInput(Number(b.dataset.q)); f.jumlah.focus(); });
  setTimeout(() => f.jumlah.focus(), 50);
  f.onsubmit = async e => {
    e.preventDefault();
    const v = parseAmount(f.jumlah.value);
    if (!v) return toast('Isi jumlah', 'error');
    const before = Number(w.dana_terkumpul);
    const dana = Math.max(0, before + (mode === 'add' ? v : -v));
    const wasFull = before >= Number(w.harga_idr);
    if (!(await patch(w, { dana_terkumpul: dana, status: dana > 0 ? 'nabung' : 'wish' }))) return;
    m.close(); draw();
    if (!wasFull && dana >= Number(w.harga_idr)) { celebrate(); setTimeout(() => sticker('🎉 DANA CUKUP!'), 700); }
    else if (mode === 'add') sticker('🐷 +' + fmt(v));
  };
}

// ---------- Beli (opsional catat di Finance) ----------
async function openBuy(w) {
  const [a, c] = await Promise.all([
    sb.from('accounts').select('*').eq('user_id', state.me.id).eq('aktif', true).order('created_at'),
    sb.from('fin_categories').select('*').eq('user_id', state.me.id).eq('tipe', 'out').order('created_at')
  ]);
  const accounts = a.data || [], cats = c.data || [];
  const defCat = cats.find(x => /belanja|fashion|lainnya/i.test(x.nama)) || cats[0];
  const m = modal({ title: `🛒 Beli · ${w.nama}` });
  m.body.innerHTML = `
    <form class="sched-form" autocomplete="off">
      <label class="amt-field"><span>Harga akhir</span>
        <div class="amt-input"><span>Rp</span><input name="harga" inputmode="decimal" required value="${fmtInput(Number(w.harga_idr))}"></div>
        <small class="muted">Ubah kalau harga belinya beda (dapat diskon, dll.)</small></label>
      <label>Tanggal beli<input type="date" name="tanggal" required value="${today()}" max="${today()}"></label>
      ${accounts.length ? `
        <label class="switch"><span>Catat sebagai pengeluaran di Finance</span><input type="checkbox" name="catat" checked></label>
        <div class="row fin-opt">
          <label>Dari akun<select name="akun">${accounts.map(x => `<option value="${x.id}">${(ACC_TYPES[x.tipe] || ACC_TYPES.lainnya)[0]} ${esc(x.nama)}</option>`).join('')}</select></label>
          <label>Kategori<select name="cat">${cats.map(x => `<option value="${x.id}" ${x.id === defCat?.id ? 'selected' : ''}>${esc(x.icon)} ${esc(x.nama)}</option>`).join('')}</select></label>
        </div>` : '<p class="muted small">Tip: buat akun di Finance supaya pembelian bisa otomatis tercatat sebagai pengeluaran.</p>'}
      <div class="form-actions" style="margin-top:8px"><button class="btn" type="submit">🎉 Tandai terbeli</button></div>
    </form>`;
  const f = m.body.querySelector('form');
  f.harga.oninput = () => { if (!/[a-z]/i.test(f.harga.value)) f.harga.value = fmtInput(parseAmount(f.harga.value)); };
  f.catat?.addEventListener('change', () => f.querySelector('.fin-opt').hidden = !f.catat.checked);
  f.onsubmit = async e => {
    e.preventDefault();
    const harga = parseAmount(f.harga.value);
    if (!harga) return toast('Isi harga akhir', 'error');
    if (f.catat?.checked) {
      const { error } = await sb.from('transactions').insert({
        tipe: 'out', jumlah_idr: harga, tanggal: f.tanggal.value, account_id: f.akun.value,
        category_id: f.cat.value || null, catatan: `Wishlist: ${w.nama}`, wishlist_id: w.id
      });
      if (error) return toast('Gagal mencatat di Finance: ' + error.message, 'error');
    }
    if (!(await patch(w, { status: 'terbeli', harga_idr: harga, dana_terkumpul: Math.max(Number(w.dana_terkumpul), harga) }))) return;
    m.close(); tab = 'terbeli'; draw();
    celebrate(); setTimeout(() => sticker('🛍️ IMPIAN TERCAPAI!'), 700);
  };
}

async function undoBuy(w) {
  const { data: tx } = await sb.from('transactions').select('id').eq('wishlist_id', w.id);
  const m = modal({ title: '↩️ Batal terbeli?' });
  m.body.innerHTML = `
    <p>"${esc(w.nama)}" akan kembali ke daftar impian.</p>
    ${tx?.length ? `<label class="switch"><span>Hapus juga ${tx.length} transaksi terkait di Finance</span><input type="checkbox" id="del-tx" checked></label>` : ''}
    <div class="form-actions" style="margin-top:14px"><button class="btn" id="ok">↩️ Kembalikan</button></div>`;
  m.body.querySelector('#ok').onclick = async () => {
    if (tx?.length && m.body.querySelector('#del-tx').checked) {
      const { error } = await sb.from('transactions').delete().in('id', tx.map(t => t.id));
      if (error) return toast(error.message, 'error');
    }
    if (!(await patch(w, { status: Number(w.dana_terkumpul) > 0 ? 'nabung' : 'wish' }))) return;
    m.close(); tab = 'aktif'; draw();
  };
}
