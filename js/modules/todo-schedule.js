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
export function createSchedule(container, { onChange } = {}) {
  let all = [], logs = [], date = today(), uid = null, timer;

  async function load(d) {
    date = d;
    const vid = state.viewing.id;
    const [s, l] = await Promise.all([
      uid === vid ? Promise.resolve({ data: all }) :
        sb.from('schedules').select('*').eq('user_id', vid).order('jam_mulai'),
      sb.from('schedule_logs').select('*').eq('user_id', vid).eq('tanggal', d)
    ]);
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

    container.querySelector('[data-act=manage]').onclick = openManager;
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
  function openManager() {
    try { assertCanEdit(); } catch (e) { return toast(e.message, 'error'); }
    const m = modal({ title: '🗓️ Kelola Jadwal Rutin', onClose: () => { uid = null; load(date); onChange?.(); } });
    let editing = null;

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
            <label class="grow">Lokasi <span class="muted small">(opsional)</span><input name="lokasi" maxlength="80" placeholder="Contoh: Ruang 2"></label>
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
            ${editing ? '<button class="btn btn-ghost" type="button" data-act="cancel">Batal edit</button>' : ''}
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

  return {
    load,
    // jumlah jadwal aktif di tanggal tertentu (untuk penanda di strip minggu)
    countFor: d => forDate(all, d).length
  };
}
