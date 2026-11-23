// =========================================================
// Jadwal Rutin — tampil di dalam halaman To-do
// Jadwal mingguan tetap (hari + jam), muncul otomatis sesuai tanggal.
// =========================================================
import { sb } from '../supabase.js';
import { state, assertCanEdit } from '../state.js';
import { toast, esc, modal } from '../ui.js';
import { sticker } from '../fx.js';
import { today, parse } from '../date.js';

export const HARI = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']; // index+1 = kode hari
const ICONS = ['📌', '👨‍🏫', '📚', '💼', '🏋️', '🏃', '🙏', '⛪', '🛕', '🍽️', '🚗', '🧘', '💊', '👨‍👩‍👧', '🎵', '💻'];
const COLORS = ['#7c9cff', '#e62429', '#f5c518', '#2f9e44', '#b08d57', '#ff2bd6', '#00b8d9', '#8b93a7'];

// ---------- Helper murni (dipakai juga di Home) ----------
export const isoDow = s => ((parse(s).getDay() + 6) % 7) + 1;           // 1=Sen..7=Min
export const hhmm = t => (t || '').slice(0, 5);
export const nowHHMM = () => new Date().toTimeString().slice(0, 5);

export function forDate(list, d) {
  const dow = isoDow(d);
  return list
    .filter(s => s.aktif && s.hari.includes(dow) && s.berlaku_mulai <= d && (!s.berlaku_sampai || d <= s.berlaku_sampai))
    .sort((a, b) => a.jam_mulai.localeCompare(b.jam_mulai));
}

export function statusOf(s, d, nextId) {
  if (d !== today()) return d < today() ? 'past' : '';
  const n = nowHHMM(), m = hhmm(s.jam_mulai), e = hhmm(s.jam_selesai);
  if (n >= m && (e ? n < e : n < addMinutes(m, 60))) return 'live';
  if (s.id === nextId) return 'next';
  return n < m ? '' : 'past';
}

function addMinutes(t, mins) {
  const [h, m] = t.split(':').map(Number);
  const x = h * 60 + m + mins;
  return `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
}

export function nextOf(items, d) {
  if (d !== today()) return null;
  const n = nowHHMM();
  return items.find(s => hhmm(s.jam_mulai) > n) || null;
}

function hariLabel(arr) {
  const a = [...arr].sort();
  if (a.length === 7) return 'Setiap hari';
  if (a.join() === '1,2,3,4,5') return 'Sen–Jum';
  if (a.join() === '6,7') return 'Akhir pekan';
  return a.map(h => HARI[h - 1]).join(', ');
}

// ---------- Komponen ----------
export function createSchedule(container, { gridContainer, onChange } = {}) {
  let all = [], logs = [], date = today(), uid = null, timer;

  async function load(d) {
    date = d;
    const vid = state.viewing.id;
    const [s, l] = await Promise.all([
      uid === vid ? Promise.resolve({ data: all }) :
        sb.from('schedules').select('*').eq('user_id', vid).order('jam_mulai'),
      sb.from('schedule_logs').select('*').eq('user_id', vid).eq('tanggal', d)
    ]);
    if (!container.isConnected) return;
    if (s.error) { container.innerHTML = ''; return toast('Gagal memuat jadwal: ' + s.error.message, 'error'); }
    all = s.data; uid = vid; logs = l.data || [];
    draw();
  }

  function draw() {
    const items = forDate(all, date);
    const ro = state.readOnly;
    const next = nextOf(items, date);
    const doneCount = items.filter(s => logs.some(l => l.schedule_id === s.id && l.done)).length;

    container.innerHTML = `
      <section class="card sched">
        <header class="sched-head">
          <h2>🗓️ Jadwal Rutin <span class="muted small">${items.length ? `${doneCount}/${items.length} dijalani` : ''}</span></h2>
          <button class="btn btn-ghost btn-sm" data-act="manage" data-edit>⚙️ Kelola</button>
        </header>
        ${items.length ? `
          <ol class="timeline">
            ${items.map(s => {
              const st = statusOf(s, date, next?.id);
              const done = logs.some(l => l.schedule_id === s.id && l.done);
              return `
                <li class="tl-item ${st} ${done ? 'done' : ''}" data-id="${s.id}" style="--c:${esc(s.warna)}">
                  <span class="tl-time">${hhmm(s.jam_mulai)}${s.jam_selesai ? `<small>${hhmm(s.jam_selesai)}</small>` : ''}</span>
                  <span class="tl-dot">${esc(s.icon)}</span>
                  <span class="tl-body">
                    <b>${esc(s.judul)}</b>
                    ${s.lokasi ? `<small class="muted">📍 ${esc(s.lokasi)}</small>` : ''}
                  </span>
                  ${st === 'live' ? '<span class="tl-chip live">● Berlangsung</span>' : ''}
                  ${st === 'next' ? `<span class="tl-chip next">Berikutnya</span>` : ''}
                  <button class="todo-check sm" data-act="log" ${ro ? 'disabled' : ''}
                    aria-label="${done ? 'Batal tandai' : 'Tandai sudah dijalani'}"><span>✓</span></button>
                </li>`;
            }).join('')}
          </ol>` : `
          <p class="muted sched-empty">${all.length ? 'Tidak ada jadwal rutin di hari ini.' :
            ro ? 'Belum ada jadwal rutin.' : 'Belum ada jadwal rutin. Klik <b>⚙️ Kelola</b> untuk menambahkan jadwal tetap mingguanmu.'}</p>`}
      </section>`;

    container.querySelector('[data-act=manage]').onclick = () => openManager();
    drawGrid();
    container.querySelectorAll('[data-act=log]').forEach(b => b.onclick = () => toggleLog(b));

    // Perbarui status "Berlangsung/Berikutnya" tiap menit
    clearInterval(timer);
    if (date === today() && items.length) {
      timer = setInterval(() => container.isConnected ? draw() : clearInterval(timer), 60000);
    }
  }

  async function toggleLog(btn) {
    try { assertCanEdit(); } catch (e) { return toast(e.message, 'error'); }
    const id = btn.closest('[data-id]').dataset.id;
    const existing = logs.find(l => l.schedule_id === id);
    if (existing) {
      logs = logs.filter(l => l !== existing); draw();
      const { error } = await sb.from('schedule_logs').delete().eq('id', existing.id);
      if (error) { logs.push(existing); draw(); toast(error.message, 'error'); }
    } else {
      const r = btn.getBoundingClientRect();
      const { data, error } = await sb.from('schedule_logs')
        .insert({ schedule_id: id, tanggal: date }).select().single();
      if (error) return toast(error.message, 'error');
      logs.push(data); draw();
      sticker(null, r.left - 60, r.top - 10);
    }
  }

  // ---------- Kelola jadwal (modal) ----------
  function openManager(editId) {
    try { assertCanEdit(); } catch (e) { return toast(e.message, 'error'); }
    const m = modal({ title: '🗓️ Kelola Jadwal Rutin', onClose: () => { uid = null; load(date); onChange?.(); } });
    let editing = editId ? all.find(s => s.id === editId) || null : null;

    const render = () => {
      const sorted = [...all].sort((a, b) => a.jam_mulai.localeCompare(b.jam_mulai));
      m.body.innerHTML = `
        <form class="sched-form" autocomplete="off">
          <div class="row">
            <label class="grow">Nama jadwal<input name="judul" required maxlength="80" placeholder="Contoh: Mengajar kelas HSK 2"></label>
          </div>
          <div class="field">
            <span class="field-label">Hari</span>
            <div class="chips" id="sf-hari">
              ${HARI.map((h, i) => `<label class="chip"><input type="checkbox" name="hari" value="${i + 1}"><span>${h}</span></label>`).join('')}
            </div>
            <div class="chips quick">
              <button type="button" class="link-btn" data-q="1,2,3,4,5">Sen–Jum</button>
              <button type="button" class="link-btn" data-q="6,7">Akhir pekan</button>
              <button type="button" class="link-btn" data-q="1,2,3,4,5,6,7">Setiap hari</button>
            </div>
          </div>
          <div class="row">
            <label>Mulai<input type="time" name="jam_mulai" required></label>
            <label>Selesai<input type="time" name="jam_selesai"></label>
            <label class="grow"><span>Lokasi <small class="muted">(opsional)</small></span><input name="lokasi" maxlength="80" placeholder="Contoh: Ruang 2"></label>
          </div>
          <div class="field">
            <span class="field-label">Ikon</span>
            <div class="chips icons">
              ${ICONS.map((ic, i) => `<label class="chip"><input type="radio" name="icon" value="${ic}" ${i === 0 ? 'checked' : ''}><span>${ic}</span></label>`).join('')}
            </div>
          </div>
          <div class="field">
            <span class="field-label">Warna</span>
            <div class="chips colors">
              ${COLORS.map((c, i) => `<label class="chip color"><input type="radio" name="warna" value="${c}" ${i === 0 ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}
            </div>
          </div>
          <div class="form-actions">
            <button class="btn" type="submit">${editing ? '💾 Simpan perubahan' : '＋ Tambah jadwal'}</button>
            ${editing ? `<button class="btn btn-ghost" type="button" data-act="cancel">Batal edit</button>
              <button class="btn btn-ghost" type="button" data-act="form-pause">${editing.aktif ? '⏸️ Jeda' : '▶️ Aktifkan'}</button>
              <button class="btn btn-ghost danger-text" type="button" data-act="form-del">🗑️ Hapus</button>` : ''}
          </div>
        </form>

        <h3 class="sched-list-title">Jadwal kamu <span class="muted small">(${all.length})</span></h3>
        <ul class="sched-list">
          ${sorted.length ? sorted.map(s => `
            <li class="${s.aktif ? '' : 'paused'} ${editing?.id === s.id ? 'editing' : ''}" data-id="${s.id}" style="--c:${esc(s.warna)}">
              <span class="sl-icon">${esc(s.icon)}</span>
              <span class="sl-body">
                <b>${esc(s.judul)}</b>
                <small class="muted">${hariLabel(s.hari)} · ${hhmm(s.jam_mulai)}${s.jam_selesai ? '–' + hhmm(s.jam_selesai) : ''}${s.lokasi ? ' · ' + esc(s.lokasi) : ''}</small>
              </span>
              <span class="sl-actions">
                <button class="icon-btn" data-act="pause" title="${s.aktif ? 'Jeda sementara' : 'Aktifkan lagi'}">${s.aktif ? '⏸️' : '▶️'}</button>
                <button class="icon-btn" data-act="edit" title="Edit">✏️</button>
                <button class="icon-btn" data-act="del" title="Hapus">🗑️</button>
              </span>
            </li>`).join('') : '<li class="muted sl-empty">Belum ada jadwal.</li>'}
        </ul>`;

      const f = m.body.querySelector('form');
      if (editing) fill(f, editing);

      f.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
        const q = b.dataset.q.split(',');
        f.querySelectorAll('[name=hari]').forEach(c => c.checked = q.includes(c.value));
      });
      f.querySelector('[data-act=cancel]')?.addEventListener('click', () => { editing = null; render(); });
      // Tombol jeda/hapus di form → pakai aksi yang sama dengan daftar
      ['pause', 'del'].forEach(a => f.querySelector(`[data-act=form-${a}]`)?.addEventListener('click', ev => {
        const li = m.body.querySelector(`.sched-list li[data-id="${editing.id}"] [data-act=${a}]`);
        if (a === 'del' && ev.currentTarget.dataset.confirm !== '1') {
          ev.currentTarget.dataset.confirm = '1'; ev.currentTarget.textContent = 'Klik lagi untuk hapus';
          return;
        }
        if (a === 'del') li.dataset.confirm = '1';
        li?.click();
      }));
      f.onsubmit = e => save(e, f);
      m.body.querySelector('.sched-list').onclick = onListClick;
    };

    function fill(f, s) {
      f.judul.value = s.judul;
      f.jam_mulai.value = hhmm(s.jam_mulai);
      f.jam_selesai.value = hhmm(s.jam_selesai);
      f.lokasi.value = s.lokasi || '';
      f.querySelectorAll('[name=hari]').forEach(c => c.checked = s.hari.includes(Number(c.value)));
      const ic = f.querySelector(`[name=icon][value="${CSS.escape(s.icon)}"]`); if (ic) ic.checked = true;
      const wc = f.querySelector(`[name=warna][value="${CSS.escape(s.warna)}"]`); if (wc) wc.checked = true;
      f.judul.focus();
    }

    async function save(e, f) {
      e.preventDefault();
      const hari = [...f.querySelectorAll('[name=hari]:checked')].map(c => Number(c.value));
      if (!hari.length) return toast('Pilih minimal 1 hari', 'error');
      if (f.jam_selesai.value && f.jam_selesai.value <= f.jam_mulai.value)
        return toast('Jam selesai harus setelah jam mulai', 'error');

      const row = {
        judul: f.judul.value.trim(), hari,
        jam_mulai: f.jam_mulai.value, jam_selesai: f.jam_selesai.value || null,
        lokasi: f.lokasi.value.trim() || null,
        icon: f.icon.value, warna: f.warna.value
      };
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true;

      const q = editing
        ? sb.from('schedules').update(row).eq('id', editing.id).select().single()
        : sb.from('schedules').insert(row).select().single();
      const { data, error } = await q;
      btn.disabled = false;
      if (error) return toast('Gagal menyimpan: ' + error.message, 'error');

      if (editing) Object.assign(all.find(s => s.id === editing.id), data);
      else all.push(data);
      toast(editing ? 'Jadwal diperbarui' : 'Jadwal ditambahkan');
      editing = null;
      render();
    }

    async function onListClick(e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const li = b.closest('[data-id]');
      const s = all.find(x => x.id === li.dataset.id);

      if (b.dataset.act === 'edit') { editing = s; render(); m.body.scrollTop = 0; return; }

      if (b.dataset.act === 'pause') {
        const aktif = !s.aktif;
        const { error } = await sb.from('schedules').update({ aktif }).eq('id', s.id);
        if (error) return toast(error.message, 'error');
        s.aktif = aktif;
        toast(aktif ? 'Jadwal aktif lagi' : 'Jadwal dijeda — tidak muncul sampai diaktifkan lagi');
        render(); return;
      }

      if (b.dataset.act === 'del') {
        if (b.dataset.confirm !== '1') {
          b.dataset.confirm = '1'; b.textContent = 'Yakin?'; b.classList.add('danger');
          setTimeout(() => { if (b.isConnected) { b.dataset.confirm = ''; b.textContent = '🗑️'; b.classList.remove('danger'); } }, 3000);
          return;
        }
        const { error } = await sb.from('schedules').delete().eq('id', s.id);
        if (error) return toast(error.message, 'error');
        all = all.filter(x => x !== s);
        if (editing?.id === s.id) editing = null;
        toast('Jadwal dihapus'); render();
      }
    }

    render();
  }

  // ---------- Tabel mingguan (kolom = hari, baris = jam) ----------
  function drawGrid() {
    if (!gridContainer) return;
    const t0 = today();
    const active = all.filter(s => s.aktif && (!s.berlaku_sampai || s.berlaku_sampai >= t0));
    if (!active.length) { gridContainer.innerHTML = ''; return; }

    const toMin = t => { const [h, m] = hhmm(t).split(':').map(Number); return h * 60 + m; };
    const endMin = s => {                      // lewat tengah malam → dipotong di 24:00
      const a = toMin(s.jam_mulai), b = s.jam_selesai ? toMin(s.jam_selesai) : a + 60;
      return Math.min(24 * 60, b > a ? b : 24 * 60);
    };
    let startH = Math.min(...active.map(s => Math.floor(toMin(s.jam_mulai) / 60)));
    let endH = Math.max(...active.map(s => Math.ceil(endMin(s) / 60)));
    startH = Math.max(0, startH);
    endH = Math.min(24, Math.max(endH, startH + 4));
    const HOUR = 64;                           // px per jam
    const px = m => (m - startH * 60) * HOUR / 60;

    // Tanggal minggu yang sedang dilihat (untuk header & sorotan hari ini)
    const sel = parse(date);
    const mon = new Date(sel); mon.setDate(sel.getDate() - ((sel.getDay() + 6) % 7));
    const todayDow = isoDow(t0), selDow = isoDow(date);
    const weekHasToday = (() => { const x = parse(t0); return x >= mon && x < new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 7); })();

    // Total jam per minggu
    const totalMin = active.reduce((sum, s) => sum + (endMin(s) - toMin(s.jam_mulai)) * s.hari.length, 0);
    const totalLabel = `${Math.floor(totalMin / 60)} jam${totalMin % 60 ? ' ' + (totalMin % 60) + ' mnt' : ''}`;

    const cols = HARI.map((nama, i) => {
      const dow = i + 1;
      const evs = active.filter(s => s.hari.includes(dow))
        .map(s => ({ s, a: toMin(s.jam_mulai), b: endMin(s) }))
        .sort((x, y) => x.a - y.a || y.b - x.b);

      // Jadwal yang bentrok jamnya ditaruh berdampingan
      let cluster = null, clusterEnd = -1;
      for (const e of evs) {
        if (!cluster || e.a >= clusterEnd) { cluster = { lanes: [], evs: [] }; clusterEnd = e.b; }
        else clusterEnd = Math.max(clusterEnd, e.b);
        let lane = cluster.lanes.findIndex(end => end <= e.a);
        if (lane < 0) { lane = cluster.lanes.length; cluster.lanes.push(e.b); } else cluster.lanes[lane] = e.b;
        e.lane = lane; e.cluster = cluster; cluster.evs.push(e);
      }

      const blocks = evs.map(e => {
        const n = e.cluster.lanes.length, h = px(e.b) - px(e.a);
        return `
          <button class="tt-block ${h < 44 ? 'short' : ''} ${n > 1 ? 'narrow' : ''}" data-id="${e.s.id}" ${state.readOnly ? 'disabled' : ''}
            style="--c:${esc(e.s.warna)};top:${px(e.a)}px;height:${h - 3}px;left:calc(${e.lane} * 100% / ${n} + 2px);width:calc(100% / ${n} - 4px)"
            title="${esc(e.s.judul)} · ${hhmm(e.s.jam_mulai)}${e.s.jam_selesai ? '–' + hhmm(e.s.jam_selesai) : ''}${e.s.lokasi ? ' · ' + esc(e.s.lokasi) : ''}">
            <b>${esc(e.s.icon)} ${esc(e.s.judul)}</b>
            <small>${hhmm(e.s.jam_mulai)}${e.s.jam_selesai ? '–' + hhmm(e.s.jam_selesai) : ''}</small>
            ${e.s.lokasi ? `<small class="tt-loc">📍 ${esc(e.s.lokasi)}</small>` : ''}
          </button>`;
      }).join('');

      // Garis waktu sekarang
      const nowM = toMin(nowHHMM());
      const nowLine = weekHasToday && dow === todayDow && nowM >= startH * 60 && nowM <= endH * 60
        ? `<div class="tt-now" style="top:${px(nowM)}px"></div>` : '';

      const d = new Date(mon); d.setDate(mon.getDate() + i);
      return {
        head: `<div class="tt-head ${weekHasToday && dow === todayDow ? 'is-today' : ''} ${dow === selDow ? 'is-sel' : ''}">
                 <span>${nama}</span><b>${d.getDate()}</b></div>`,
        body: `<div class="tt-col ${weekHasToday && dow === todayDow ? 'is-today' : ''}">${blocks}${nowLine}</div>`
      };
    });

    const hours = Array.from({ length: endH - startH }, (_, k) => startH + k);
    gridContainer.innerHTML = `
      <section class="card tt">
        <header class="sched-head">
          <h2>📅 Jadwal Mingguan <span class="muted small">⏱️ ${totalLabel} / minggu</span></h2>
          <button class="btn btn-ghost btn-sm" data-act="manage" data-edit>⚙️ Kelola</button>
        </header>
        <div class="tt-scroll">
          <div class="tt-grid" style="--rows:${hours.length};--hour:${HOUR}px">
            <div class="tt-corner"></div>
            ${cols.map(c => c.head).join('')}
            <div class="tt-times">${hours.map(h => `<span>${String(h).padStart(2, '0')}:00</span>`).join('')}</div>
            ${cols.map(c => c.body).join('')}
          </div>
        </div>
        <p class="muted small tt-hint" data-edit>Klik blok jadwal untuk mengedit.</p>
      </section>`;

    gridContainer.querySelector('[data-act=manage]').onclick = () => openManager();
    gridContainer.querySelectorAll('.tt-block').forEach(b => b.onclick = () => {
      try { assertCanEdit(); } catch { return; }
      openManager(b.dataset.id);
    });
  }

  return {
    load,
    // jumlah jadwal aktif di tanggal tertentu (untuk penanda di strip minggu)
    countFor: d => forDate(all, d).length
  };
}
