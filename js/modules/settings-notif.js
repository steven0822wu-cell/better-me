// Bagian "🔔 Notifikasi" di halaman Setting
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { toast, esc, modal } from '../ui.js';
import { sticker } from '../fx.js';
import { deviceStatus, enable, disable, sendTest, preview, isIOS } from '../push.js';

// Harus sama dengan DEFAULTS di Edge Function
const DEFAULTS = {
  pagi: { on: true, time: '06:30' }, jadwal: { on: true, before: 15 }, habit: { on: true },
  streak: { on: true, time: '21:00', min: 3 }, todo_penting: { on: true, time: '17:00' },
  gym: { on: true, time: '18:00', days: 3 }, budget: { on: true }, lupa_catat: { on: true, time: '21:00' },
  rekap: { on: true, time: '08:00' }, invest: { on: true, time: '19:00' }, target: { on: true, time: '08:00' },
  wishlist: { on: true }
};
const GROUPS = [
  ['To-do & Jadwal', [
    ['pagi', '☀️ Ringkasan pagi', 'To-do, jadwal & habit hari ini'],
    ['jadwal', '🗓️ Jadwal rutin', 'Sebelum jadwal mulai — tetap muncul saat jam tenang'],
    ['todo_penting', '🔥 To-do penting', 'Tugas prioritas Penting yang belum selesai']]],
  ['Habit & Gym', [
    ['habit', '✅ Pengingat per habit', 'Jamnya diatur di tiap habit (✏️ Edit habit) — hanya kalau belum dicentang'],
    ['streak', '🔥 Streak hampir putus', 'Habit harian dengan streak ≥ 3 hari yang belum dicentang'],
    ['gym', '💪 Lama tidak latihan', 'Kalau sudah beberapa hari tanpa latihan']]],
  ['Keuangan', [
    ['budget', '⚡ Budget menipis / terlewati', 'Saat pemakaian 80% dan saat lewat batas'],
    ['lupa_catat', '🧾 Lupa catat keuangan', 'Kalau seharian belum ada transaksi'],
    ['rekap', '📊 Rekap bulanan', 'Tanggal 1 tiap bulan'],
    ['invest', '📈 Update harga investasi', 'Tiap Minggu, kalau harga belum diupdate > 7 hari']]],
  ['Target & Wishlist', [
    ['target', '🎯 Deadline target', 'H-7, H-1 dan hari H'],
    ['wishlist', '🎁 Dana wishlist cukup', 'Saat tabungan wishlist mencapai harga']]]
];

let box, cfg, saveTimer;

export async function renderNotif(container) {
  box = container;
  box.innerHTML = `<h2>🔔 Notifikasi HP</h2><p class="muted">Memuat…</p>`;
  const [{ data, error }, status, logs] = await Promise.all([
    sb.from('notif_settings').select('*').eq('user_id', state.me.id).maybeSingle(),
    deviceStatus(),
    sb.from('notif_log').select('title,body,sent_at').eq('user_id', state.me.id).order('sent_at', { ascending: false }).limit(8)
  ]);
  if (!box.isConnected) return;
  if (error && /relation|schema cache|does not exist/i.test(error.message)) {
    box.innerHTML = `<h2>🔔 Notifikasi HP</h2><p class="muted">Fitur notifikasi belum dipasang di database. Ikuti panduan pemasangan notifikasi (jalankan <b>05_notifikasi.sql</b>).</p>`;
    return;
  }
  cfg = data || { user_id: state.me.id, enabled: true, tz: 'Asia/Jakarta', quiet_start: '23:00', quiet_end: '06:00', prefs: {} };
  cfg.created = !!data;
  const P = k => ({ ...DEFAULTS[k], ...(cfg.prefs?.[k] || {}) });

  box.innerHTML = `
    <h2>🔔 Notifikasi HP</h2>
    <div class="notif-device st-${status}">${deviceHtml(status)}</div>

    <label class="switch notif-master"><span><b>Semua pengingat</b><br><span class="muted small">Matikan untuk menghentikan semua notifikasi sementara</span></span>
      <input type="checkbox" id="nf-enabled" ${cfg.enabled ? 'checked' : ''}></label>

    <div class="notif-groups" ${cfg.enabled ? '' : 'hidden'}>
      ${GROUPS.map(([g, items]) => `
        <h3 class="notif-group">${g}</h3>
        ${items.map(([k, label, desc]) => {
          const p = P(k);
          return `
            <div class="notif-item ${p.on ? '' : 'off'}" data-k="${k}">
              <label class="switch"><span>${label}<br><span class="muted small">${desc}</span></span>
                <input type="checkbox" data-f="on" ${p.on ? 'checked' : ''}></label>
              <div class="notif-opts">
                ${'time' in DEFAULTS[k] ? `<label>Jam<input type="time" data-f="time" value="${esc(p.time)}"></label>` : ''}
                ${'before' in DEFAULTS[k] ? `<label>Menit sebelum<select data-f="before">${[5, 10, 15, 30, 60].map(n => `<option value="${n}" ${+p.before === n ? 'selected' : ''}>${n} menit</option>`).join('')}</select></label>` : ''}
                ${'days' in DEFAULTS[k] ? `<label>Setelah<select data-f="days">${[2, 3, 4, 5, 7].map(n => `<option value="${n}" ${+p.days === n ? 'selected' : ''}>${n} hari</option>`).join('')}</select></label>` : ''}
              </div>
            </div>`;
        }).join('')}`).join('')}

      <h3 class="notif-group">🌙 Jam tenang</h3>
      <p class="muted small">Selama jam ini notifikasi ditahan, kecuali jadwal rutin & habit yang jamnya kamu atur sendiri.</p>
      <div class="row">
        <label>Mulai<input type="time" id="nf-qs" value="${esc(String(cfg.quiet_start).slice(0, 5))}"></label>
        <label>Selesai<input type="time" id="nf-qe" value="${esc(String(cfg.quiet_end).slice(0, 5))}"></label>
      </div>
    </div>

    <details class="notif-log">
      <summary class="muted small">Riwayat notifikasi terakhir</summary>
      ${logs.data?.length ? `<ul>${logs.data.map(l => `<li><b>${esc(l.title)}</b><span class="muted small">${esc(l.body || '')}</span>
        <small class="muted">${new Date(l.sent_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></li>`).join('')}</ul>`
        : '<p class="muted small">Belum ada notifikasi terkirim.</p>'}
      <button class="link-btn" id="nf-preview">🔍 Cek pengingat yang jatuh tempo sekarang</button>
    </details>`;

  bind(status);
}

function deviceHtml(st) {
  const ios = isIOS();
  switch (st) {
    case 'on': return `<p>✅ <b>Aktif di perangkat ini.</b></p>
      <div class="form-actions"><button class="btn btn-sm" id="nf-test">📨 Kirim notifikasi tes</button>
      <button class="btn btn-ghost btn-sm" id="nf-off">Matikan di perangkat ini</button></div>`;
    case 'off': return `<p>Notifikasi belum aktif di perangkat ini.</p>
      <button class="btn" id="nf-on">🔔 Aktifkan di perangkat ini</button>
      <p class="muted small">Aktifkan di setiap HP/laptop yang mau menerima pengingat.</p>`;
    case 'need-install': return `<p>📱 <b>Di iPhone/iPad, notifikasi hanya jalan dari app yang di-install.</b></p>
      <ol class="small"><li>Buka app ini di <b>Safari</b></li><li>Tap tombol <b>Share</b> (kotak dengan panah ke atas)</li>
      <li>Pilih <b>Add to Home Screen</b></li><li>Buka Better Me dari ikon di layar utama, lalu kembali ke Setting ini</li></ol>
      <p class="muted small">Butuh iOS 16.4 atau lebih baru.</p>`;
    case 'denied': return `<p>🚫 <b>Izin notifikasi ditolak.</b></p>
      <p class="small">${ios ? 'Buka <b>Pengaturan iPhone → Notifikasi → Better Me</b> lalu izinkan.'
        : 'Tap ikon 🔒/ⓘ di samping alamat web (atau Info aplikasi → Notifikasi) lalu izinkan notifikasi, kemudian muat ulang app.'}</p>`;
    default: return `<p>⚠️ Browser ini tidak mendukung notifikasi push. Coba pakai Chrome (Android/laptop) atau Safari dari ikon Home Screen (iPhone).</p>`;
  }
}

function bind(status) {
  const $ = s => box.querySelector(s);
  $('#nf-on')?.addEventListener('click', async ev => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = '⏳ Mengaktifkan…';
    try {
      await enable();
      if (!cfg.created) await persist(true);
      toast('Notifikasi aktif di perangkat ini');
      sticker('🔔 ON');
      renderNotif(box);
      setTimeout(() => sendTest().catch(() => {}), 800);
    } catch (e) {
      toast(e.message, 'error', { duration: 5000 });
      b.disabled = false; b.textContent = '🔔 Aktifkan di perangkat ini';
    }
  });
  $('#nf-off')?.addEventListener('click', async () => {
    try { await disable(); toast('Notifikasi dimatikan di perangkat ini'); renderNotif(box); }
    catch (e) { toast(e.message, 'error'); }
  });
  $('#nf-test')?.addEventListener('click', async ev => {
    const b = ev.currentTarget; b.disabled = true;
    try { const r = await sendTest(); toast(`Terkirim ke ${r.sent} perangkat — cek notifikasi HP`); }
    catch (e) { toast(e.message, 'error', { duration: 5000 }); }
    b.disabled = false;
  });
  $('#nf-preview')?.addEventListener('click', async () => {
    try {
      const r = await preview();
      const m = modal({ title: `🔍 Pengingat jatuh tempo (${r.now.time})` });
      m.body.innerHTML = r.planned.length
        ? `<ul class="sched-list">${r.planned.map(p => `<li><span class="sl-body"><b>${esc(p.title)}</b><small class="muted">${esc(p.body)}</small></span></li>`).join('')}</ul>
           <p class="muted small">Yang sudah pernah terkirim tidak dikirim ulang. Jam tenang tetap berlaku.</p>`
        : '<p class="muted">Tidak ada pengingat yang jatuh tempo saat ini.</p>';
    } catch (e) { toast(e.message, 'error'); }
  });

  $('#nf-enabled').onchange = e => {
    cfg.enabled = e.target.checked;
    $('.notif-groups').hidden = !cfg.enabled;
    queueSave();
  };
  box.querySelectorAll('.notif-item').forEach(item => {
    const k = item.dataset.k;
    item.querySelectorAll('[data-f]').forEach(inp => inp.onchange = () => {
      const f = inp.dataset.f;
      const v = f === 'on' ? inp.checked : (f === 'time' ? inp.value : Number(inp.value));
      cfg.prefs = { ...(cfg.prefs || {}), [k]: { ...(cfg.prefs?.[k] || {}), [f]: v } };
      if (f === 'on') item.classList.toggle('off', !v);
      queueSave();
    });
  });
  $('#nf-qs').onchange = e => { cfg.quiet_start = e.target.value || '23:00'; queueSave(); };
  $('#nf-qe').onchange = e => { cfg.quiet_end = e.target.value || '06:00'; queueSave(); };
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(false), 500);
}

async function persist(silent) {
  const row = {
    user_id: state.me.id, enabled: cfg.enabled, quiet_start: cfg.quiet_start, quiet_end: cfg.quiet_end,
    prefs: cfg.prefs || {}, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta',
    updated_at: new Date().toISOString()
  };
  const { error } = await sb.from('notif_settings').upsert(row, { onConflict: 'user_id' });
  if (error) return toast('Gagal menyimpan pengaturan notifikasi: ' + error.message, 'error');
  cfg.created = true;
  if (!silent) toast('Pengaturan notifikasi tersimpan');
}
