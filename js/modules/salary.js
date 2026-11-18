// =========================================================
// 💼 Gaji Mengajar — kalkulator & riwayat slip (di halaman Finance)
// Murni pencatatan: tidak membuat transaksi / mengubah saldo.
// =========================================================
import { sb } from '../supabase.js';
import { state, assertCanEdit } from '../state.js';
import { toast, esc, modal } from '../ui.js';
import { sticker } from '../fx.js';
import { parse, ymd } from '../date.js';
import { parseAmount, fmtInput } from './finance.js';

export const TARIF = {
  murid_bulan:     { label: 'Per murid / bulan',      short: '/murid/bulan',      murid: true,  pert: false },
  murid_pertemuan: { label: 'Per murid / pertemuan',  short: '/murid/pertemuan',  murid: true,  pert: true },
  kelas_pertemuan: { label: 'Per kelas / pertemuan',  short: '/pertemuan',        murid: false, pert: true },
  kelas_bulan:     { label: 'Per kelas / bulan (tetap)', short: '/bulan',         murid: false, pert: false }
};
const rp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const pctTxt = n => String(+Number(n).toFixed(2)).replace('.', ',') + '%';
const BULAN = m => parse(m + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
const shift = (m, n) => { const d = parse(m + '-01'); d.setMonth(d.getMonth() + n); return ymd(d).slice(0, 7); };
const numIn = v => Number(String(v ?? '').replace(',', '.')) || 0;

// ---------- Rumus ----------
export function calcItem(it) {
  const t = TARIF[it.jenis_tarif] || TARIF.murid_bulan;
  const kotor = Number(it.tarif) * (t.murid ? Number(it.murid) || 0 : 1) * (t.pert ? Number(it.pertemuan) || 0 : 1);
  return { kotor, bagian: kotor * (Number(it.bagi_hasil) || 0) / 100 };
}
export function calcSlip(s) {
  const items = (s.items || []).map(it => ({ ...it, ...calcItem(it) }));
  const kotor = items.reduce((a, i) => a + i.kotor, 0);
  const bagian = items.reduce((a, i) => a + i.bagian, 0);
  const potPct = bagian * (Number(s.potongan_pct) || 0) / 100;
  const potLain = (s.potongan || []).reduce((a, p) => a + (Number(p.jumlah) || 0), 0);
  const tambah = (s.tambahan || []).reduce((a, p) => a + (Number(p.jumlah) || 0), 0);
  return { items, kotor, bagian, potPct, potLain, tambah, bersih: bagian - potPct - potLain + tambah };
}

// ---------- Komponen ----------
export function createSalary(box, { onMonth } = {}) {
  let classes = [], slips = [], month = null, loaded = false, failed = false;

  async function load() {
    const uid = state.viewing.id;
    const [c, s] = await Promise.all([
      sb.from('salary_classes').select('*').eq('user_id', uid).order('urutan').order('created_at'),
      sb.from('salary_slips').select('*').eq('user_id', uid).order('bulan', { ascending: false })
    ]);
    if (!box.isConnected) return;
    failed = !!c.error;
    classes = c.data || []; slips = s.data || []; loaded = true;
    if (month) draw();
  }

  function show(m) { month = m; if (loaded) draw(); }

  function draw() {
    if (failed) {
      box.innerHTML = state.readOnly ? '' : `<header class="sched-head"><h2>💼 Gaji Mengajar</h2></header>
        <p class="muted small">Fitur gaji belum aktif — jalankan <b>08_gaji.sql</b> di Supabase.</p>`;
      return;
    }
    const slip = slips.find(s => s.bulan === month);
    const c = slip ? calcSlip(slip) : null;
    const hist = slips.filter(s => s.bulan <= month).slice(0, 6).reverse();
    const max = Math.max(1, ...hist.map(s => Number(s.total_bersih)));
    const prev = slips.find(s => s.bulan === shift(month, -1));
    const diff = c && prev ? c.bersih - Number(prev.total_bersih) : null;

    box.innerHTML = `
      <header class="sched-head">
        <h2>💼 Gaji Mengajar <span class="muted small">${BULAN(month)}</span></h2>
        <div class="date-nav" data-edit>
          <button class="btn btn-ghost btn-sm" data-act="classes">⚙️ Kelas (${classes.filter(x => x.aktif).length})</button>
          ${slip ? '<button class="btn btn-sm" data-act="edit">✏️ Edit slip</button>' : ''}
        </div>
      </header>
      ${c ? `
        <div class="sal-top">
          <div class="sal-net">
            <span class="muted small">Gaji bersih</span>
            <b>${rp(c.bersih)}</b>
            ${diff !== null ? `<small class="${diff >= 0 ? 'amt-in' : 'amt-out'}">${diff >= 0 ? '▲' : '▼'} ${rp(Math.abs(diff))} vs ${BULAN(prev.bulan).split(' ')[0]}</small>` : ''}
          </div>
          <ol class="sal-flow">
            <li><span>Total kelas (kotor)</span><b>${rp(c.kotor)}</b></li>
            <li><span>Bagian saya (bagi hasil)</span><b>${rp(c.bagian)}</b></li>
            ${c.potPct ? `<li class="minus"><span>Potongan ${pctTxt(slip.potongan_pct)}</span><b>−${rp(c.potPct)}</b></li>` : ''}
            ${(slip.potongan || []).map(p => `<li class="minus"><span>${esc(p.nama)}</span><b>−${rp(p.jumlah)}</b></li>`).join('')}
            ${(slip.tambahan || []).map(p => `<li class="plus"><span>${esc(p.nama)}</span><b>+${rp(p.jumlah)}</b></li>`).join('')}
          </ol>
        </div>
        <details class="sal-detail">
          <summary class="muted small">Rincian ${c.items.length} kelas</summary>
          <table class="set-table"><thead><tr><th>Kelas</th><th>Hitungan</th><th>Kotor</th><th>Bagian</th></tr></thead><tbody>
            ${c.items.map(i => `<tr><td>${esc(i.nama)}</td><td class="small">${formula(i)}</td><td>${rp(i.kotor)}</td><td>${rp(i.bagian)}<br><small class="muted">${pctTxt(i.bagi_hasil)}</small></td></tr>`).join('')}
          </tbody></table>
          ${slip.catatan ? `<p class="muted small">📝 ${esc(slip.catatan)}</p>` : ''}
          <button class="link-btn" data-act="copy">📋 Salin rincian (untuk WhatsApp/catatan)</button>
        </details>` : `
        <div class="empty sal-empty">
          <div class="empty-icon">🧮</div>
          <p class="muted">${state.readOnly ? 'Belum ada slip gaji bulan ini.' : classes.length
            ? `Belum ada slip gaji ${BULAN(month)}.` : 'Tambahkan daftar kelas & tarifnya dulu, lalu hitung gaji tiap bulan.'}</p>
          <button class="btn" data-act="${classes.length ? 'edit' : 'classes'}" data-edit>${classes.length ? '🧮 Hitung gaji bulan ini' : '＋ Tambah kelas'}</button>
        </div>`}
      ${hist.length > 1 ? `
        <div class="sal-hist">
          <span class="muted small">Riwayat gaji bersih</span>
          <div class="sal-bars">${hist.map(s => `
            <button class="sal-bar ${s.bulan === month ? 'on' : ''}" data-m="${s.bulan}" title="${BULAN(s.bulan)}: ${rp(s.total_bersih)}">
              <span class="sal-bar-v">${(Number(s.total_bersih) / 1e6).toFixed(1).replace('.', ',')}jt</span>
              <i style="height:${Math.max(4, Number(s.total_bersih) / max * 70)}px"></i>
              <small>${parse(s.bulan + '-01').toLocaleDateString('id-ID', { month: 'short' })}</small>
            </button>`).join('')}</div>
        </div>` : ''}`;

    box.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      if (b.dataset.act === 'copy') return copyText(slip, c);
      try { assertCanEdit(); } catch (e) { return toast(e.message, 'error'); }
      if (b.dataset.act === 'edit') return openSlip();
      if (b.dataset.act === 'classes') return openClasses();
    });
    box.querySelectorAll('[data-m]').forEach(b => b.onclick = () => onMonth?.(b.dataset.m));
  }

  function formula(i) {
    const t = TARIF[i.jenis_tarif] || TARIF.murid_bulan;
    const parts = [rp(i.tarif) + t.short];
    if (t.murid) parts.push(`${i.murid || 0} murid`);
    if (t.pert) parts.push(`${i.pertemuan || 0} pertemuan`);
    return parts.join(' × ');
  }

  async function copyText(slip, c) {
    const lines = [`Slip Gaji ${BULAN(slip.bulan)}${state.viewing ? ' — ' + state.viewing.display_name : ''}`, ''];
    c.items.forEach(i => lines.push(`• ${i.nama}: ${formula(i)} = ${rp(i.kotor)} → ${pctTxt(i.bagi_hasil)} = ${rp(i.bagian)}`));
    lines.push('', `Total kotor: ${rp(c.kotor)}`, `Bagian saya: ${rp(c.bagian)}`);
    if (c.potPct) lines.push(`Potongan ${pctTxt(slip.potongan_pct)}: −${rp(c.potPct)}`);
    (slip.potongan || []).forEach(p => lines.push(`${p.nama}: −${rp(p.jumlah)}`));
    (slip.tambahan || []).forEach(p => lines.push(`${p.nama}: +${rp(p.jumlah)}`));
    lines.push(`GAJI BERSIH: ${rp(c.bersih)}`);
    if (slip.catatan) lines.push('', `Catatan: ${slip.catatan}`);
    try { await navigator.clipboard.writeText(lines.join('\n')); toast('Rincian disalin 📋'); }
    catch { toast('Gagal menyalin — browser tidak mengizinkan', 'error'); }
  }

  // ---------- Slip bulanan ----------
  function openSlip() {
    const ex = slips.find(s => s.bulan === month);
    const prev = slips.find(s => s.bulan < month);
    // Mulai dari slip yang ada; kalau baru → semua kelas aktif dengan angka kosong
    let items = ex ? ex.items.map(i => ({ ...i })) : classes.filter(c => c.aktif).map(c => ({
      class_id: c.id, nama: c.nama, jenis_tarif: c.jenis_tarif, tarif: Number(c.tarif), bagi_hasil: Number(c.bagi_hasil), murid: '', pertemuan: ''
    }));
    let potongan = (ex?.potongan || prev?.potongan || []).map(p => ({ ...p }));
    let tambahan = (ex?.tambahan || []).map(p => ({ ...p }));
    let potPct = ex ? Number(ex.potongan_pct) : Number(prev?.potongan_pct || 0);
    let catatan = ex?.catatan || '';
    const m = modal({ title: `🧮 Gaji ${BULAN(month)}` });

    const render = () => {
      const missing = classes.filter(c => c.aktif && !items.some(i => i.class_id === c.id));
      m.body.innerHTML = `
        <form class="sched-form sal-form" autocomplete="off">
          ${prev && !ex ? `<button type="button" class="link-btn" data-act="copy-prev">📋 Salin murid & pertemuan dari ${BULAN(prev.bulan)}</button>` : ''}
          <div class="sal-items">
            ${items.map((i, k) => {
              const t = TARIF[i.jenis_tarif] || TARIF.murid_bulan, r = calcItem(i);
              return `
                <div class="sal-item" data-k="${k}">
                  <div class="sal-item-head"><b>${esc(i.nama)}</b><small class="muted">${rp(i.tarif)}${t.short}</small>
                    <button type="button" class="icon-btn sm" data-rm="${k}" title="Hapus dari slip ini">✕</button></div>
                  <div class="sal-inputs">
                    ${t.murid ? `<label>Murid<input data-f="murid" inputmode="numeric" value="${i.murid ?? ''}" placeholder="0"></label>` : ''}
                    ${t.pert ? `<label>Pertemuan<input data-f="pertemuan" inputmode="numeric" value="${i.pertemuan ?? ''}" placeholder="0"></label>` : ''}
                    <label>Bagi hasil %<input data-f="bagi_hasil" inputmode="decimal" value="${String(i.bagi_hasil).replace('.', ',')}"></label>
                    <div class="sal-res"><small class="muted">${rp(r.kotor)}</small><b>${rp(r.bagian)}</b></div>
                  </div>
                </div>`;
            }).join('') || '<p class="muted">Belum ada kelas di slip ini.</p>'}
          </div>
          ${missing.length ? `<div class="suggest" style="justify-content:flex-start">${missing.map(c => `<button type="button" class="chip-btn" data-add="${c.id}">＋ ${esc(c.nama)}</button>`).join('')}</div>` : ''}

          <h3 class="sched-list-title">Potongan</h3>
          <label class="sal-pct"><span>Potongan % <small class="muted">(pajak / admin — dihitung dari bagian saya)</small></span>
            <input name="potpct" inputmode="decimal" value="${String(potPct).replace('.', ',')}"></label>
          ${listEditor('pot', potongan, 'Contoh: Kasbon, BPJS, denda telat')}
          <h3 class="sched-list-title">Tambahan <small class="muted">(opsional)</small></h3>
          ${listEditor('tam', tambahan, 'Contoh: Bonus, uang transport, THR')}
          <label><span>Catatan <small class="muted">(opsional)</small></span><input name="catatan" maxlength="200" value="${esc(catatan)}"></label>

          <div class="sal-sum" id="sal-sum"></div>
          <div class="form-actions">
            <button class="btn" type="submit">💾 Simpan slip</button>
            ${ex ? '<button class="btn btn-ghost danger-text" type="button" data-act="del">🗑️ Hapus slip</button>' : ''}
          </div>
        </form>`;
      bind();
      summary();
    };

    const listEditor = (key, arr, ph) => `
      <div class="sal-list" data-list="${key}">
        ${arr.map((p, k) => `<div class="sal-li" data-k="${k}">
          <input data-f="nama" placeholder="${ph}" value="${esc(p.nama || '')}" maxlength="40">
          <div class="amt-input sm"><span>Rp</span><input data-f="jumlah" inputmode="decimal" value="${p.jumlah ? fmtInput(Number(p.jumlah)) : ''}" placeholder="0"></div>
          <button type="button" class="icon-btn sm" data-rmli="${key}:${k}">✕</button></div>`).join('')}
        <button type="button" class="link-btn" data-addli="${key}">＋ Tambah ${key === 'pot' ? 'potongan' : 'tambahan'}</button>
      </div>`;

    const sync = () => {
      const f = m.body.querySelector('form');
      f.querySelectorAll('.sal-item').forEach(row => {
        const it = items[row.dataset.k];
        row.querySelectorAll('[data-f]').forEach(inp => it[inp.dataset.f] = inp.dataset.f === 'bagi_hasil' ? Math.min(100, numIn(inp.value)) : inp.value === '' ? '' : numIn(inp.value));
      });
      const readList = (key, arr) => f.querySelectorAll(`[data-list=${key}] .sal-li`).forEach(li => {
        const p = arr[li.dataset.k];
        p.nama = li.querySelector('[data-f=nama]').value;
        p.jumlah = parseAmount(li.querySelector('[data-f=jumlah]').value);
      });
      readList('pot', potongan); readList('tam', tambahan);
      potPct = Math.min(100, numIn(f.potpct.value));
      catatan = f.catatan.value;
    };

    const summary = () => {
      sync();
      const c = calcSlip({ items, potongan_pct: potPct, potongan, tambahan });
      m.body.querySelectorAll('.sal-item').forEach(row => {
        const r = c.items[row.dataset.k];
        row.querySelector('.sal-res').innerHTML = `<small class="muted">${rp(r.kotor)}</small><b>${rp(r.bagian)}</b>`;
      });
      m.body.querySelector('#sal-sum').innerHTML = `
        <div><span>Total kelas (kotor)</span><b>${rp(c.kotor)}</b></div>
        <div><span>Bagian saya</span><b>${rp(c.bagian)}</b></div>
        ${c.potPct ? `<div class="minus"><span>Potongan ${pctTxt(potPct)}</span><b>−${rp(c.potPct)}</b></div>` : ''}
        ${c.potLain ? `<div class="minus"><span>Potongan lain</span><b>−${rp(c.potLain)}</b></div>` : ''}
        ${c.tambah ? `<div class="plus"><span>Tambahan</span><b>+${rp(c.tambah)}</b></div>` : ''}
        <div class="sal-total"><span>Gaji bersih</span><b>${rp(c.bersih)}</b></div>`;
    };

    const bind = () => {
      const f = m.body.querySelector('form');
      f.addEventListener('input', e => {
        const t = e.target;
        if (t.dataset.f === 'jumlah' && !/[a-z]/i.test(t.value)) t.value = fmtInput(parseAmount(t.value));
        summary();
      });
      f.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { sync(); items.splice(Number(b.dataset.rm), 1); render(); });
      f.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
        sync();
        const c = classes.find(x => x.id === b.dataset.add);
        items.push({ class_id: c.id, nama: c.nama, jenis_tarif: c.jenis_tarif, tarif: Number(c.tarif), bagi_hasil: Number(c.bagi_hasil), murid: '', pertemuan: '' });
        render();
      });
      f.querySelectorAll('[data-addli]').forEach(b => b.onclick = () => {
        sync(); (b.dataset.addli === 'pot' ? potongan : tambahan).push({ nama: '', jumlah: 0 }); render();
        m.body.querySelector(`[data-list=${b.dataset.addli}] .sal-li:last-of-type [data-f=nama]`)?.focus();
      });
      f.querySelectorAll('[data-rmli]').forEach(b => b.onclick = () => {
        sync(); const [key, k] = b.dataset.rmli.split(':'); (key === 'pot' ? potongan : tambahan).splice(Number(k), 1); render();
      });
      f.querySelector('[data-act=copy-prev]')?.addEventListener('click', () => {
        sync();
        items.forEach(i => {
          const p = prev.items.find(x => x.class_id === i.class_id);
          if (p) { i.murid = p.murid; i.pertemuan = p.pertemuan; }
        });
        render(); toast(`Disalin dari ${BULAN(prev.bulan)} — sesuaikan yang berubah`);
      });

      f.onsubmit = async e => {
        e.preventDefault();
        sync();
        const clean = items.map(i => ({ class_id: i.class_id, nama: i.nama, jenis_tarif: i.jenis_tarif, tarif: Number(i.tarif),
          bagi_hasil: Number(i.bagi_hasil), murid: Number(i.murid) || 0, pertemuan: Number(i.pertemuan) || 0 }));
        if (!clean.length) return toast('Slip belum berisi kelas', 'error');
        const pot = potongan.filter(p => p.nama.trim() && p.jumlah > 0).map(p => ({ nama: p.nama.trim(), jumlah: p.jumlah }));
        const tam = tambahan.filter(p => p.nama.trim() && p.jumlah > 0).map(p => ({ nama: p.nama.trim(), jumlah: p.jumlah }));
        const c = calcSlip({ items: clean, potongan_pct: potPct, potongan: pot, tambahan: tam });
        const row = {
          user_id: state.me.id, bulan: month, items: clean, potongan_pct: potPct, potongan: pot, tambahan: tam,
          total_kotor: c.kotor, total_bagian: c.bagian, total_bersih: c.bersih, catatan: catatan.trim() || null,
          updated_at: new Date().toISOString()
        };
        const { data, error } = await sb.from('salary_slips').upsert(row, { onConflict: 'user_id,bulan' }).select().single();
        if (error) return toast('Gagal menyimpan: ' + error.message, 'error');
        slips = [data, ...slips.filter(s => s.bulan !== month)].sort((a, b) => b.bulan.localeCompare(a.bulan));
        m.close(); draw(); sticker(`💼 ${rp(c.bersih)}`);
      };
      f.querySelector('[data-act=del]')?.addEventListener('click', async ev => {
        const b = ev.currentTarget;
        if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Klik lagi untuk hapus'; return; }
        const { error } = await sb.from('salary_slips').delete().eq('id', ex.id);
        if (error) return toast(error.message, 'error');
        slips = slips.filter(s => s !== ex); m.close(); draw();
      });
    };
    render();
  }

  // ---------- Kelola kelas ----------
  async function openClasses() {
    const { data: sched } = await sb.from('schedules').select('judul').eq('user_id', state.me.id).eq('aktif', true);
    const m = modal({ title: '⚙️ Kelas & Tarif', onClose: draw });
    let editing = null;

    const render = () => {
      const fromSched = [...new Set((sched || []).map(s => s.judul.trim()))].filter(n => !classes.some(c => c.nama.toLowerCase() === n.toLowerCase()));
      const e = editing || {};
      m.body.innerHTML = `
        <form class="sched-form" autocomplete="off">
          ${!editing && fromSched.length ? `<div class="field"><span class="field-label">Ambil dari jadwal rutin</span>
            <div class="suggest" style="justify-content:flex-start">${fromSched.map(n => `<button type="button" class="chip-btn" data-name="${esc(n)}">＋ ${esc(n)}</button>`).join('')}</div></div>` : ''}
          <label>${editing ? 'Edit kelas' : 'Nama kelas'}<input name="nama" required maxlength="60" value="${esc(e.nama || '')}" placeholder="Contoh: KGOFF-2-1 Aihui, Private Jawaii"></label>
          <div class="field"><span class="field-label">Cara hitung tarif</span>
            <div class="tipe-grid">${Object.entries(TARIF).map(([k, v]) => `
              <label class="tipe-opt"><input type="radio" name="jt" value="${k}" ${(e.jenis_tarif || 'murid_bulan') === k ? 'checked' : ''}><span><b>${v.label}</b></span></label>`).join('')}</div></div>
          <div class="row">
            <label class="amt-field grow"><span>Tarif</span><div class="amt-input"><span>Rp</span><input name="tarif" inputmode="decimal" required value="${e.tarif ? fmtInput(Number(e.tarif)) : ''}" placeholder="0"></div></label>
            <label><span>Bagi hasil % <small class="muted">(bagian saya)</small></span><input name="bagi" inputmode="decimal" value="${String(e.bagi_hasil ?? 100).replace('.', ',')}"></label>
          </div>
          <div class="form-actions"><button class="btn btn-sm" type="submit">${editing ? '💾 Simpan' : '＋ Tambah kelas'}</button>
            ${editing ? '<button class="btn btn-ghost btn-sm" type="button" data-act="cancel">Batal</button>' : ''}</div>
        </form>
        <h3 class="sched-list-title">Daftar kelas (${classes.length})</h3>
        <ul class="sched-list">${classes.map(c => `
          <li class="${c.aktif ? '' : 'paused'}" data-id="${c.id}">
            <span class="sl-body"><b>${esc(c.nama)}</b><small class="muted">${rp(c.tarif)}${TARIF[c.jenis_tarif].short} · bagi hasil ${pctTxt(c.bagi_hasil)}${c.aktif ? '' : ' · nonaktif'}</small></span>
            <span class="sl-actions">
              <button class="icon-btn" data-a="toggle" title="${c.aktif ? 'Nonaktifkan' : 'Aktifkan'}">${c.aktif ? '⏸️' : '▶️'}</button>
              <button class="icon-btn" data-a="edit" title="Edit">✏️</button>
              <button class="icon-btn" data-a="del" title="Hapus">🗑️</button></span></li>`).join('') || '<li class="muted sl-empty">Belum ada kelas.</li>'}</ul>
        <p class="muted small">Mengubah tarif tidak mengubah slip bulan-bulan sebelumnya.</p>`;

      const f = m.body.querySelector('form');
      f.tarif.oninput = () => { if (!/[a-z]/i.test(f.tarif.value)) f.tarif.value = fmtInput(parseAmount(f.tarif.value)); };
      f.querySelectorAll('[data-name]').forEach(b => b.onclick = () => { f.nama.value = b.dataset.name; f.tarif.focus(); });
      f.querySelector('[data-act=cancel]')?.addEventListener('click', () => { editing = null; render(); });
      f.onsubmit = async ev => {
        ev.preventDefault();
        const row = { nama: f.nama.value.trim(), jenis_tarif: f.jt.value, tarif: parseAmount(f.tarif.value), bagi_hasil: Math.min(100, numIn(f.bagi.value)) };
        if (!(row.tarif > 0)) return toast('Isi tarif', 'error');
        const q = editing ? sb.from('salary_classes').update(row).eq('id', editing.id).select().single()
                          : sb.from('salary_classes').insert({ ...row, urutan: classes.length }).select().single();
        const { data, error } = await q;
        if (error) return toast('Gagal menyimpan: ' + error.message, 'error');
        if (editing) Object.assign(editing, data); else classes.push(data);
        editing = null; render();
      };
      m.body.querySelector('.sched-list').onclick = async ev => {
        const b = ev.target.closest('[data-a]'); if (!b) return;
        const c = classes.find(x => x.id === b.closest('[data-id]').dataset.id);
        if (b.dataset.a === 'edit') { editing = c; render(); m.body.scrollTop = 0; return; }
        if (b.dataset.a === 'toggle') {
          const { error } = await sb.from('salary_classes').update({ aktif: !c.aktif }).eq('id', c.id);
          if (error) return toast(error.message, 'error');
          c.aktif = !c.aktif; return render();
        }
        if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Yakin?'; b.classList.add('danger'); return; }
        const { error } = await sb.from('salary_classes').delete().eq('id', c.id);
        if (error) return toast(error.message, 'error');
        classes = classes.filter(x => x !== c); render();
      };
    };
    render();
  }

  load();
  return { show };
}
