// =========================================================
// 💼 Gaji Mengajar — tabel per bagian (gaya spreadsheet) di halaman Finance
// Murni pencatatan: tidak membuat transaksi / mengubah saldo.
//
// Rumus per baris:
//   simple : Total = Price × Qty
//   bagi   : Get = Price × %   ·   Total Pot = Pot × Qty   ·   Total = Get × Qty − Total Pot
// =========================================================
import { sb } from '../supabase.js';
import { state, assertCanEdit } from '../state.js';
import { toast, esc } from '../ui.js';
import { sticker } from '../fx.js';
import { parse, ymd } from '../date.js';
import { parseAmount, fmtInput } from './finance.js';

const HARI = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const rp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const pctTxt = n => String(+Number(n).toFixed(2)).replace('.', ',') + '%';
const BULAN = m => parse(m + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
const shift = (m, n) => { const d = parse(m + '-01'); d.setMonth(d.getMonth() + n); return ymd(d).slice(0, 7); };
const numIn = v => Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0;
const pctIn = v => Math.min(100, Number(String(v ?? '').replace(',', '.')) || 0);

// ---------- Rumus ----------
export function calcRow(r, mode) {
  const price = Number(r.price) || 0, qty = Number(r.qty) || 0;
  if (mode !== 'bagi') return { get: price, totPot: 0, total: price * qty };
  const get = price * (Number(r.pct) || 0) / 100, totPot = (Number(r.pot) || 0) * qty;
  return { get, totPot, total: get * qty - totPot };
}

// Slip versi lama (kelas + jenis tarif) → baris tabel
function normalize(s) {
  if (!s) return null;
  if ((s.sections || []).length) return s;
  const items = (s.items || []).map(i => {
    if ('price' in i) return i;
    const m = Number(i.murid) || 0, p = Number(i.pertemuan) || 0, t = Number(i.tarif) || 0;
    const map = { murid_bulan: [t, m], murid_pertemuan: [t * p, m], kelas_pertemuan: [t, p], kelas_bulan: [t, 1] }[i.jenis_tarif] || [t, 1];
    return { grup: 'KELAS', nama: i.nama, jadwal: '', price: map[0], qty: map[1], pct: Number(i.bagi_hasil ?? 100), pot: 0 };
  });
  return { ...s, items, sections: [{ nama: 'KELAS', mode: 'bagi' }] };
}

export function calcSlip(s) {
  s = normalize(s) || { items: [], sections: [] };
  const secs = s.sections.map(sec => {
    const rows = s.items.filter(i => i.grup === sec.nama).map(r => ({ ...r, ...calcRow(r, sec.mode) }));
    return { ...sec, rows, total: rows.reduce((a, r) => a + r.total, 0), kotor: rows.reduce((a, r) => a + (Number(r.price) || 0) * (Number(r.qty) || 0), 0) };
  });
  const subtotal = secs.reduce((a, x) => a + x.total, 0);
  const potPct = subtotal * (Number(s.potongan_pct) || 0) / 100;
  const potLain = (s.potongan || []).reduce((a, p) => a + (Number(p.jumlah) || 0), 0);
  const tambah = (s.tambahan || []).reduce((a, p) => a + (Number(p.jumlah) || 0), 0);
  return { secs, subtotal, kotor: secs.reduce((a, x) => a + x.kotor, 0), potPct, potLain, tambah, bersih: subtotal - potPct - potLain + tambah };
}

// ---------- Komponen ----------
export function createSalary(box, { onMonth } = {}) {
  let slips = [], schedules = [], month = null, loaded = false, failed = false;
  let edit = null;   // salinan slip yang sedang diedit

  async function load() {
    const uid = state.viewing.id;
    const [s, sc] = await Promise.all([
      sb.from('salary_slips').select('*').eq('user_id', uid).order('bulan', { ascending: false }),
      sb.from('schedules').select('judul,hari,jam_mulai,jam_selesai').eq('user_id', uid).eq('aktif', true)
    ]);
    if (!box.isConnected) return;
    failed = !!s.error;
    slips = (s.data || []).map(normalize); schedules = sc.data || []; loaded = true;
    if (month) draw();
  }

  function show(m) { if (edit && m !== month) edit = null; month = m; if (loaded) draw(); }

  // Jadwal dari Jadwal Rutin dengan format seperti Excel: "35 [16.00-17.30]"
  function jadwalOf(nama) {
    const n = nama.trim().toLowerCase();
    if (!n) return '';
    const s = schedules.find(x => x.judul.trim().toLowerCase() === n) || schedules.find(x => x.judul.toLowerCase().includes(n) || n.includes(x.judul.toLowerCase()));
    if (!s) return '';
    const hm = t => String(t || '').slice(0, 5).replace(':', '.');
    return `${[...s.hari].sort().join('')} [${hm(s.jam_mulai)}${s.jam_selesai ? '-' + hm(s.jam_selesai) : ''}]`;
  }

  function draw() {
    if (failed) {
      box.innerHTML = state.readOnly ? '' : `<header class="sched-head"><h2>💼 Gaji Mengajar</h2></header>
        <p class="muted small">Fitur gaji belum aktif — jalankan <b>08_gaji.sql</b> lalu <b>09_gaji_tabel.sql</b> di Supabase.</p>`;
      return;
    }
    if (edit) return drawEdit();
    const slip = slips.find(s => s.bulan === month);
    const prev = slips.find(s => s.bulan === shift(month, -1));
    const hist = slips.filter(s => s.bulan <= month).slice(0, 6).reverse();
    const max = Math.max(1, ...hist.map(s => Number(s.total_bersih)));

    box.innerHTML = `
      <header class="sched-head">
        <h2>💼 Gaji Mengajar <span class="muted small">${BULAN(month)}</span></h2>
        <div class="date-nav" data-edit>
          ${slip ? `<button class="btn btn-ghost btn-sm" data-act="copy">📋 Salin teks</button><button class="btn btn-sm" data-act="edit">✏️ Edit tabel</button>`
                 : `<button class="btn btn-sm" data-act="new">🧮 Buat tabel gaji</button>`}
        </div>
      </header>
      ${slip ? viewTable(slip, prev) : `
        <div class="empty sal-empty"><div class="empty-icon">🧮</div>
          <p class="muted">${state.readOnly ? 'Belum ada slip gaji bulan ini.'
            : slips.length ? `Belum ada tabel gaji ${BULAN(month)}. Buat baru — bisa salin isi bulan sebelumnya.` : 'Buat tabel gaji pertamamu: isi kelas, price, persen, qty, dan potongan seperti di Excel.'}</p></div>`}
      ${hist.length > 1 ? `
        <div class="sal-hist"><span class="muted small">Riwayat total gaji</span>
          <div class="sal-bars">${hist.map(s => `
            <button class="sal-bar ${s.bulan === month ? 'on' : ''}" data-m="${s.bulan}" title="${BULAN(s.bulan)}: ${rp(s.total_bersih)}">
              <span class="sal-bar-v">${(Number(s.total_bersih) / 1e6).toFixed(1).replace('.', ',')}jt</span>
              <i style="height:${Math.max(4, Number(s.total_bersih) / max * 70)}px"></i>
              <small>${parse(s.bulan + '-01').toLocaleDateString('id-ID', { month: 'short' })}</small></button>`).join('')}</div></div>` : ''}`;

    box.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      if (b.dataset.act === 'copy') return copyText(slip);
      try { assertCanEdit(); } catch (e) { return toast(e.message, 'error'); }
      if (b.dataset.act === 'edit') startEdit(slip);
      if (b.dataset.act === 'new') startEdit(null);
    });
    box.querySelectorAll('[data-m]').forEach(b => b.onclick = () => onMonth?.(b.dataset.m));
  }

  // ---------- Tampilan tabel ----------
  function viewTable(slip, prev) {
    const c = calcSlip(slip);
    const diff = prev ? c.bersih - Number(prev.total_bersih) : null;
    return `
      ${c.secs.map(sec => `
        <div class="sal-sec">
          <div class="sal-scroll"><table class="sal-table ${sec.mode}">
            <thead><tr><th class="c-no">No</th><th class="c-nama">${esc(sec.nama)}</th><th>Schedule</th><th class="num">Price</th>
              ${sec.mode === 'bagi' ? '<th class="num">%</th><th class="num">Get</th>' : ''}<th class="num">Qty</th>
              ${sec.mode === 'bagi' ? '<th class="num">Potongan</th><th class="num">Total Pot.</th>' : ''}<th class="num">Total</th></tr></thead>
            <tbody>${sec.rows.map((r, k) => `<tr>
              <td class="c-no">${k + 1}</td><td class="c-nama">${esc(r.nama)}</td><td class="c-jadwal">${esc(r.jadwal || '')}</td>
              <td class="num">${rp(r.price)}</td>
              ${sec.mode === 'bagi' ? `<td class="num">${pctTxt(r.pct)}</td><td class="num">${rp(r.get)}</td>` : ''}
              <td class="num">${r.qty || 0}</td>
              ${sec.mode === 'bagi' ? `<td class="num">${rp(r.pot)}</td><td class="num neg">${r.totPot ? '−' + rp(r.totPot) : '–'}</td>` : ''}
              <td class="num b">${rp(r.total)}</td></tr>`).join('') || `<tr><td colspan="10" class="muted">Belum ada baris.</td></tr>`}</tbody>
            <tfoot><tr><td colspan="${sec.mode === 'bagi' ? 9 : 5}" class="sal-subt">TOTAL ${esc(sec.nama)}</td><td class="num b">${rp(sec.total)}</td></tr></tfoot>
          </table></div>
        </div>`).join('')}
      ${c.potPct || c.potLain || c.tambah ? `
        <ol class="sal-flow sal-adj">
          <li><span>Subtotal tabel</span><b>${rp(c.subtotal)}</b></li>
          ${c.potPct ? `<li class="minus"><span>Potongan ${pctTxt(slip.potongan_pct)}</span><b>−${rp(c.potPct)}</b></li>` : ''}
          ${(slip.potongan || []).map(p => `<li class="minus"><span>${esc(p.nama)}</span><b>−${rp(p.jumlah)}</b></li>`).join('')}
          ${(slip.tambahan || []).map(p => `<li class="plus"><span>${esc(p.nama)}</span><b>+${rp(p.jumlah)}</b></li>`).join('')}
        </ol>` : ''}
      <div class="sal-grand">
        <span>TOTAL GAJI</span>
        <div><b>${rp(c.bersih)}</b>${diff !== null ? `<small class="${diff >= 0 ? 'amt-in' : 'amt-out'}">${diff >= 0 ? '▲' : '▼'} ${rp(Math.abs(diff))} vs ${BULAN(prev.bulan).split(' ')[0]}</small>` : ''}</div>
      </div>
      ${slip.catatan ? `<p class="muted small">📝 ${esc(slip.catatan)}</p>` : ''}`;
  }

  // ---------- Mode edit (langsung di tabel) ----------
  function startEdit(slip) {
    if (slip) edit = JSON.parse(JSON.stringify(normalize(slip)));
    else {
      const prev = slips.find(s => s.bulan < month);
      edit = { bulan: month, items: [], sections: [{ nama: 'PRIBADI', mode: 'simple' }, { nama: 'KELAS', mode: 'bagi' }],
        potongan_pct: 0, potongan: [], tambahan: [], catatan: '', _prev: prev ? prev.bulan : null };
      edit.items.push({ grup: 'PRIBADI', nama: '', jadwal: '', price: 0, qty: 0, pct: 100, pot: 0 },
                      { grup: 'KELAS', nama: '', jadwal: '', price: 0, qty: 0, pct: 90, pot: 0 });
    }
    edit.potongan = edit.potongan || []; edit.tambahan = edit.tambahan || [];
    draw();
  }

  function drawEdit() {
    const e = edit;
    const c = calcSlip(e);
    const prevSlip = e._prev ? slips.find(s => s.bulan === e._prev) : null;
    box.innerHTML = `
      <header class="sched-head">
        <h2>✏️ Gaji ${BULAN(month)}</h2>
        <div class="date-nav">
          <button class="btn btn-ghost btn-sm" data-act="cancel">Batal</button>
          <button class="btn btn-sm" data-act="save">💾 Simpan</button>
        </div>
      </header>
      ${prevSlip ? `<p class="sal-copy"><button class="btn btn-ghost btn-sm" data-act="copy-prev">📋 Salin semua isi tabel ${BULAN(prevSlip.bulan)}</button>
        <span class="muted small">lalu tinggal ubah Qty yang berbeda</span></p>` : ''}
      ${c.secs.map((sec, si) => `
        <div class="sal-sec editing" data-si="${si}">
          <div class="sal-sec-head">
            <input class="sal-sec-name" data-sec="nama" value="${esc(sec.nama)}" maxlength="30" aria-label="Nama bagian">
            <div class="seg">
              <button type="button" data-mode="simple" class="${sec.mode === 'simple' ? 'active' : ''}" title="Total = Price × Qty">Price × Qty</button>
              <button type="button" data-mode="bagi" class="${sec.mode === 'bagi' ? 'active' : ''}" title="(Price × % − Potongan) × Qty">Pakai % & potongan</button>
            </div>
            <button type="button" class="icon-btn sm" data-delsec title="Hapus bagian">🗑️</button>
          </div>
          <div class="sal-scroll"><table class="sal-table ${sec.mode} edit">
            <thead><tr><th class="c-no">No</th><th class="c-nama">Nama / kelas</th><th>Schedule</th><th class="num">Price</th>
              ${sec.mode === 'bagi' ? '<th class="num">%</th><th class="num">Get</th>' : ''}<th class="num">Qty</th>
              ${sec.mode === 'bagi' ? '<th class="num">Potongan</th><th class="num">Total Pot.</th>' : ''}<th class="num">Total</th><th></th></tr></thead>
            <tbody>${sec.rows.map((r, k) => {
              const idx = e.items.indexOf(e.items.filter(i => i.grup === sec.nama)[k]);
              return `<tr data-i="${idx}">
                <td class="c-no">${k + 1}</td>
                <td class="c-nama"><input data-f="nama" value="${esc(r.nama)}" placeholder="Nama murid / kelas" list="sal-names"></td>
                <td class="c-jadwal"><input data-f="jadwal" value="${esc(r.jadwal || '')}" placeholder="24 [13.30-14.30]"></td>
                <td class="num"><input data-f="price" inputmode="numeric" value="${r.price ? fmtInput(Number(r.price)) : ''}" placeholder="0"></td>
                ${sec.mode === 'bagi' ? `<td class="num c-pct"><input data-f="pct" inputmode="decimal" value="${String(r.pct ?? 100).replace('.', ',')}"></td>
                  <td class="num calc" data-o="get">${rp(r.get)}</td>` : ''}
                <td class="num c-qty"><input data-f="qty" inputmode="numeric" value="${r.qty || ''}" placeholder="0"></td>
                ${sec.mode === 'bagi' ? `<td class="num"><input data-f="pot" inputmode="numeric" value="${r.pot ? fmtInput(Number(r.pot)) : ''}" placeholder="0"></td>
                  <td class="num calc neg" data-o="totPot">${r.totPot ? '−' + rp(r.totPot) : '–'}</td>` : ''}
                <td class="num calc b" data-o="total">${rp(r.total)}</td>
                <td><button type="button" class="icon-btn sm" data-delrow title="Hapus baris">✕</button></td></tr>`;
            }).join('')}</tbody>
            <tfoot><tr><td colspan="${sec.mode === 'bagi' ? 9 : 5}" class="sal-subt">
                <button type="button" class="link-btn" data-addrow>＋ Tambah baris</button><span>TOTAL ${esc(sec.nama)}</span></td>
              <td class="num b" data-sectotal>${rp(sec.total)}</td><td></td></tr></tfoot>
          </table></div>
        </div>`).join('')}
      <button type="button" class="btn btn-ghost btn-sm" data-act="addsec">＋ Tambah bagian</button>

      <details class="sal-extra" ${e.potongan.length || e.tambahan.length || Number(e.potongan_pct) ? 'open' : ''}>
        <summary class="muted small">Penyesuaian lain (opsional): potongan % total, kasbon, bonus…</summary>
        <label class="sal-pct"><span>Potongan % dari total tabel</span><input data-x="potongan_pct" inputmode="decimal" value="${String(e.potongan_pct || 0).replace('.', ',')}"></label>
        ${adjList('potongan', 'Potongan lain', 'Contoh: Kasbon, BPJS')}
        ${adjList('tambahan', 'Tambahan', 'Contoh: Bonus, transport, THR')}
      </details>
      <label class="sal-note"><span>Catatan <small class="muted">(opsional)</small></span><input data-x="catatan" maxlength="200" value="${esc(e.catatan || '')}"></label>

      <div class="sal-grand"><span>TOTAL GAJI</span><div><b data-grand>${rp(c.bersih)}</b></div></div>
      <datalist id="sal-names">${[...new Set(schedules.map(s => s.judul))].map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
    bindEdit();
  }

  const adjList = (key, label, ph) => `
    <div class="sal-list" data-adj="${key}"><span class="field-label">${label}</span>
      ${edit[key].map((p, k) => `<div class="sal-li" data-k="${k}">
        <input data-a="nama" placeholder="${ph}" value="${esc(p.nama || '')}" maxlength="40">
        <div class="amt-input sm"><span>Rp</span><input data-a="jumlah" inputmode="decimal" value="${p.jumlah ? fmtInput(Number(p.jumlah)) : ''}" placeholder="0"></div>
        <button type="button" class="icon-btn sm" data-deladj="${k}">✕</button></div>`).join('')}
      <button type="button" class="link-btn" data-addadj>＋ Tambah</button></div>`;

  // Hitung ulang angka tanpa render ulang (supaya kursor tidak lompat)
  function recalc() {
    const c = calcSlip(edit);
    c.secs.forEach((sec, si) => {
      const wrap = box.querySelector(`.sal-sec[data-si="${si}"]`);
      if (!wrap) return;
      wrap.querySelector('[data-sectotal]').textContent = rp(sec.total);
      wrap.querySelectorAll('tbody tr').forEach((tr, k) => {
        const r = sec.rows[k];
        if (!r) return;
        tr.querySelectorAll('[data-o]').forEach(td => {
          const v = r[td.dataset.o];
          td.textContent = td.dataset.o === 'totPot' ? (v ? '−' + rp(v) : '–') : rp(v);
        });
      });
    });
    box.querySelector('[data-grand]').textContent = rp(c.bersih);
  }

  function bindEdit() {
    const e = edit;
    box.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const a = b.dataset.act;
      if (a === 'cancel') { edit = null; return draw(); }
      if (a === 'save') return save();
      if (a === 'addsec') {
        let n = 'BAGIAN BARU', k = 2; while (e.sections.some(s => s.nama === n)) n = `BAGIAN BARU ${k++}`;
        e.sections.push({ nama: n, mode: 'bagi' });
        e.items.push({ grup: n, nama: '', jadwal: '', price: 0, qty: 0, pct: 90, pot: 0 });
        drawEdit(); box.querySelector('.sal-sec:last-of-type .sal-sec-name')?.select(); return;
      }
      if (a === 'copy-prev') {
        const p = normalize(slips.find(s => s.bulan === e._prev));
        Object.assign(e, JSON.parse(JSON.stringify({ items: p.items, sections: p.sections, potongan_pct: p.potongan_pct || 0, potongan: p.potongan || [], tambahan: [] })));
        e._prev = null; drawEdit(); toast(`Disalin dari ${BULAN(p.bulan)} — ubah Qty yang berbeda`);
      }
    });

    box.querySelectorAll('.sal-sec.editing').forEach(wrap => {
      const sec = e.sections[wrap.dataset.si];
      wrap.querySelector('[data-sec=nama]').onchange = ev => {
        const nn = ev.target.value.trim().toUpperCase() || sec.nama;
        if (nn !== sec.nama && e.sections.some(s => s.nama === nn)) { toast('Nama bagian sudah dipakai', 'error'); ev.target.value = sec.nama; return; }
        e.items.forEach(i => { if (i.grup === sec.nama) i.grup = nn; });
        sec.nama = nn; drawEdit();
      };
      wrap.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { sec.mode = b.dataset.mode; drawEdit(); });
      wrap.querySelector('[data-delsec]').onclick = ev => {
        const b = ev.currentTarget;
        if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Yakin?'; b.classList.add('danger'); return; }
        e.items = e.items.filter(i => i.grup !== sec.nama); e.sections.splice(wrap.dataset.si, 1); drawEdit();
      };
      wrap.querySelector('[data-addrow]').onclick = () => {
        const last = [...e.items].reverse().find(i => i.grup === sec.nama);
        const row = { grup: sec.nama, nama: '', jadwal: '', price: 0, qty: 0, pct: last?.pct ?? (sec.mode === 'bagi' ? 90 : 100), pot: last?.pot ?? 0 };
        const at = last ? e.items.indexOf(last) + 1 : e.items.length;
        e.items.splice(at, 0, row); drawEdit();
        wrap.ownerDocument.querySelector(`.sal-sec[data-si="${wrap.dataset.si}"] tbody tr:last-child [data-f=nama]`)?.focus();
      };
      wrap.querySelectorAll('[data-delrow]').forEach(b => b.onclick = () => {
        e.items.splice(Number(b.closest('tr').dataset.i), 1); drawEdit();
      });
      wrap.querySelectorAll('tbody tr').forEach(tr => {
        const it = e.items[tr.dataset.i];
        tr.querySelectorAll('[data-f]').forEach(inp => {
          inp.oninput = () => {
            const f = inp.dataset.f;
            if (f === 'price' || f === 'pot') { if (!/[a-z]/i.test(inp.value)) inp.value = fmtInput(parseAmount(inp.value)); it[f] = parseAmount(inp.value); }
            else if (f === 'pct') it.pct = pctIn(inp.value);
            else if (f === 'qty') it.qty = numIn(inp.value);
            else it[f] = inp.value;
            recalc();
          };
        });
        // Nama cocok dengan jadwal rutin → isi kolom Schedule otomatis
        tr.querySelector('[data-f=nama]').onchange = ev => {
          const j = tr.querySelector('[data-f=jadwal]');
          if (!j.value) { const v = jadwalOf(ev.target.value); if (v) { j.value = v; it.jadwal = v; } }
        };
      });
    });

    box.querySelectorAll('[data-x]').forEach(inp => inp.oninput = () => {
      if (inp.dataset.x === 'potongan_pct') e.potongan_pct = pctIn(inp.value); else e.catatan = inp.value;
      recalc();
    });
    box.querySelectorAll('[data-adj]').forEach(list => {
      const arr = e[list.dataset.adj];
      list.querySelector('[data-addadj]').onclick = () => { arr.push({ nama: '', jumlah: 0 }); drawEdit(); };
      list.querySelectorAll('[data-deladj]').forEach(b => b.onclick = () => { arr.splice(Number(b.dataset.deladj), 1); drawEdit(); });
      list.querySelectorAll('.sal-li').forEach(li => {
        const p = arr[li.dataset.k];
        li.querySelector('[data-a=nama]').oninput = ev => p.nama = ev.target.value;
        li.querySelector('[data-a=jumlah]').oninput = ev => {
          if (!/[a-z]/i.test(ev.target.value)) ev.target.value = fmtInput(parseAmount(ev.target.value));
          p.jumlah = parseAmount(ev.target.value); recalc();
        };
      });
    });
  }

  async function save() {
    try { assertCanEdit(); } catch (err) { return toast(err.message, 'error'); }
    const e = edit;
    const items = e.items.filter(i => String(i.nama).trim() || Number(i.price) || Number(i.qty))
      .map(i => ({ grup: i.grup, nama: String(i.nama).trim(), jadwal: String(i.jadwal || '').trim(), price: Number(i.price) || 0,
        qty: Number(i.qty) || 0, pct: Number(i.pct ?? 100), pot: Number(i.pot) || 0 }));
    if (!items.length) return toast('Tabel masih kosong', 'error');
    const sections = e.sections.filter(s => items.some(i => i.grup === s.nama));
    const potongan = e.potongan.filter(p => p.nama.trim() && p.jumlah > 0).map(p => ({ nama: p.nama.trim(), jumlah: p.jumlah }));
    const tambahan = e.tambahan.filter(p => p.nama.trim() && p.jumlah > 0).map(p => ({ nama: p.nama.trim(), jumlah: p.jumlah }));
    const c = calcSlip({ items, sections, potongan_pct: e.potongan_pct, potongan, tambahan });
    const row = {
      user_id: state.me.id, bulan: month, items, sections, potongan_pct: Number(e.potongan_pct) || 0, potongan, tambahan,
      total_kotor: c.kotor, total_bagian: c.subtotal, total_bersih: c.bersih, catatan: (e.catatan || '').trim() || null,
      updated_at: new Date().toISOString()
    };
    const btn = box.querySelector('[data-act=save]'); btn.disabled = true;
    const { data, error } = await sb.from('salary_slips').upsert(row, { onConflict: 'user_id,bulan' }).select().single();
    btn.disabled = false;
    if (error) return toast('Gagal menyimpan: ' + (/sections|schema cache/i.test(error.message) ? 'jalankan dulu 09_gaji_tabel.sql di Supabase' : error.message), 'error');
    slips = [normalize(data), ...slips.filter(s => s.bulan !== month)].sort((a, b) => b.bulan.localeCompare(a.bulan));
    edit = null; draw(); sticker(`💼 ${rp(c.bersih)}`);
  }

  async function copyText(slip) {
    const c = calcSlip(slip);
    const L = [`SLIP GAJI ${BULAN(slip.bulan).toUpperCase()}${state.viewing ? ' — ' + state.viewing.display_name : ''}`];
    c.secs.forEach(sec => {
      L.push('', `▸ ${sec.nama}`);
      sec.rows.forEach((r, k) => L.push(sec.mode === 'bagi'
        ? `${k + 1}. ${r.nama}${r.jadwal ? ' ' + r.jadwal : ''}: ${rp(r.price)} × ${pctTxt(r.pct)} = ${rp(r.get)} × ${r.qty}${r.totPot ? ` − ${rp(r.totPot)}` : ''} = ${rp(r.total)}`
        : `${k + 1}. ${r.nama}${r.jadwal ? ' ' + r.jadwal : ''}: ${rp(r.price)} × ${r.qty} = ${rp(r.total)}`));
      L.push(`TOTAL ${sec.nama}: ${rp(sec.total)}`);
    });
    if (c.potPct) L.push('', `Potongan ${pctTxt(slip.potongan_pct)}: −${rp(c.potPct)}`);
    (slip.potongan || []).forEach(p => L.push(`${p.nama}: −${rp(p.jumlah)}`));
    (slip.tambahan || []).forEach(p => L.push(`${p.nama}: +${rp(p.jumlah)}`));
    L.push('', `TOTAL GAJI: ${rp(c.bersih)}`);
    try { await navigator.clipboard.writeText(L.join('\n')); toast('Rincian disalin 📋'); }
    catch { toast('Gagal menyalin — browser tidak mengizinkan', 'error'); }
  }

  load();
  return { show };
}
