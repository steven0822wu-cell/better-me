// Pengaturan → Personel (khusus admin) & ganti password sendiri
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { THEMES } from '../theme.js';
import { toast, modal, esc } from '../ui.js';
import { sticker } from '../fx.js';

const USER_RE = /^[a-z0-9._-]{3,20}$/;
const themeName = id => { const t = THEMES.find(x => x.id === id); return t ? `${t.emoji} ${t.nama}` : id; };
const hasPersonel = () => state.all.some(p => 'privat' in p);   // SQL 11 sudah dijalankan?

async function callAkun(body) {
  const { data, error } = await sb.functions.invoke('akun', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* bukan JSON */ }
    if (/Failed to send|not found|404/i.test(msg)) msg = 'Edge Function "akun" belum dipasang di Supabase';
    throw new Error(msg);
  }
  if (!data?.ok) throw new Error(data?.error || 'Gagal');
  return data;
}

// ---------- Kartu "Akun" untuk semua user ----------
export function renderAccount(box) {
  const me = state.me;
  const priv = me.privat;
  box.innerHTML = `
    <h2>Akun</h2>
    <p>Masuk sebagai <b>${esc(me.display_name)}</b>${me.username ? ` <span class="muted">· @${esc(me.username)}</span>` : ''}
      ${me.is_admin ? '<span class="pill ps-badge">👑 Admin</span>' : ''}</p>
    ${hasPersonel() && !me.is_admin ? `<p class="muted small">${priv
      ? '🔒 Akunmu <b>privat</b>: orang lain tidak bisa memantau datamu, dan kamu juga tidak bisa memantau orang lain.'
      : '👁 Akunmu <b>terbuka</b>: kamu dan akun terbuka lainnya bisa saling pantau (hanya baca).'} Privasi diatur oleh admin.</p>` : ''}
    <div class="row-wrap">
      <button class="btn btn-ghost" id="btn-mypw">🔑 Ganti password saya</button>
      <button class="btn btn-ghost" id="btn-logout">Keluar</button>
    </div>`;
  box.querySelector('#btn-mypw').onclick = myPassword;
}

function myPassword() {
  const m = modal({ title: '🔑 Ganti password saya', html: `
    <form class="ps-form">
      <label>Password baru<input type="password" name="pw" minlength="6" maxlength="72" required autocomplete="new-password"></label>
      <label>Ulangi password baru<input type="password" name="pw2" minlength="6" maxlength="72" required autocomplete="new-password"></label>
      <button class="btn btn-block">Simpan password</button>
    </form>` });
  const f = m.body.querySelector('form');
  f.pw.focus();
  f.onsubmit = async e => {
    e.preventDefault();
    if (f.pw.value !== f.pw2.value) return toast('Password tidak sama', 'error');
    const btn = f.querySelector('button'); btn.disabled = true;
    const { error } = await sb.auth.updateUser({ password: f.pw.value });
    btn.disabled = false;
    if (error) return toast('Gagal: ' + error.message, 'error');
    m.close(); toast('Password diganti — pakai password baru saat login berikutnya');
  };
}

// ---------- Kartu "Personel" (admin) ----------
export function renderPersonel(box) {
  if (!state.me.is_admin) { box.hidden = true; return; }
  box.hidden = false;
  const list = [...state.all].sort((a, b) => (b.is_admin - a.is_admin) || (b.aktif - a.aktif) ||
    String(a.created_at).localeCompare(String(b.created_at)));
  box.innerHTML = `
    <header class="ps-head">
      <div><h2>👥 Personel</h2>
        <p class="muted small">Tambah akun & atur username/password. <b>🔒 Privat</b> = datanya tidak bisa dipantau dan dia tidak bisa memantau orang lain. Kamu sebagai admin tetap bisa melihat semua (hanya baca).</p></div>
      <button class="btn" id="ps-add">＋ Personel</button>
    </header>
    <ul class="ps-list">${list.map(row).join('')}</ul>`;
  box.querySelector('#ps-add').onclick = () => openForm();
  box.querySelector('.ps-list').onclick = e => onAction(e, box);
  box.querySelector('.ps-list').onchange = e => onPrivacy(e, box);
}

function row(p) {
  const self = p.id === state.me.id;
  return `
    <li class="ps-item ${p.aktif === false ? 'off' : ''}" data-id="${p.id}">
      <span class="ps-avatar" data-theme="${esc(p.theme)}">${esc([...p.display_name][0].toUpperCase())}</span>
      <div class="ps-info">
        <span><b>${esc(p.display_name)}</b>${self ? ' <span class="muted small">(kamu)</span>' : ''}</span>
        <span class="muted small">@${esc(p.username || '—')} · ${themeName(p.theme)}</span>
        <span class="ps-badges">
          ${p.is_admin ? '<span class="pill ps-badge">👑 Admin</span>' : ''}
          ${p.aktif === false ? '<span class="pill ps-badge off">💤 Nonaktif</span>' : ''}
        </span>
      </div>
      <label class="switch ps-priv" title="Privat: tidak bisa dipantau & tidak bisa memantau">
        <span>${p.privat ? '🔒 Privat' : '👁 Terbuka'}</span>
        <input type="checkbox" data-priv ${p.privat ? 'checked' : ''} ${p.aktif === false ? 'disabled' : ''}>
      </label>
      <div class="ps-actions">
        <button class="btn btn-ghost btn-sm" data-act="edit">✏️ Edit</button>
        <button class="btn btn-ghost btn-sm" data-act="pw">🔑 Password</button>
        ${self || p.is_admin ? '' : p.aktif === false
          ? '<button class="btn btn-ghost btn-sm" data-act="on">▶ Aktifkan</button><button class="btn btn-ghost btn-sm danger-text" data-act="del">🗑 Hapus</button>'
          : '<button class="btn btn-ghost btn-sm" data-act="off">💤 Nonaktifkan</button>'}
      </div>
    </li>`;
}

async function reload(box) {
  await state.refreshProfiles?.();
  renderPersonel(box);
}

async function onPrivacy(e, box) {
  const cb = e.target.closest('[data-priv]'); if (!cb) return;
  const id = cb.closest('.ps-item').dataset.id, privat = cb.checked;
  const p = state.all.find(x => x.id === id);
  cb.disabled = true;
  const { error } = await sb.from('profiles').update({ privat }).eq('id', id);
  if (error) { cb.checked = !privat; cb.disabled = false; return toast('Gagal: ' + error.message, 'error'); }
  toast(privat ? `🔒 ${p.display_name} sekarang privat` : `👁 ${p.display_name} sekarang terbuka`);
  await reload(box);
}

async function onAction(e, box) {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const p = state.all.find(x => x.id === btn.closest('.ps-item').dataset.id);
  const act = btn.dataset.act;
  if (act === 'edit') return openForm(p, box);
  if (act === 'pw') return setPassword(p);
  try {
    if (act === 'off') {
      if (!confirm(`Nonaktifkan ${p.display_name}?\n\nDia tidak bisa login & tidak muncul di halaman login. Datanya tetap aman dan bisa diaktifkan lagi kapan saja.`)) return;
      btn.disabled = true; await callAkun({ action: 'aktif', id: p.id, aktif: false });
      toast(`💤 ${p.display_name} dinonaktifkan`);
    } else if (act === 'on') {
      btn.disabled = true; await callAkun({ action: 'aktif', id: p.id, aktif: true });
      toast(`▶ ${p.display_name} aktif lagi`);
    } else if (act === 'del') {
      const typed = prompt(`HAPUS PERMANEN akun ${p.display_name} beserta SEMUA datanya (habit, finance, invest, dll)?\nTidak bisa dibatalkan.\n\nKetik username-nya untuk konfirmasi: ${p.username}`);
      if (typed === null) return;
      if (typed.trim().toLowerCase() !== p.username) return toast('Username tidak cocok — batal dihapus', 'error');
      btn.disabled = true; await callAkun({ action: 'delete', id: p.id });
      toast(`🗑 Akun ${p.display_name} dihapus`);
    }
  } catch (err) { btn.disabled = false; return toast(err.message, 'error'); }
  await reload(box);
}

function setPassword(p) {
  const self = p.id === state.me.id;
  const m = modal({ title: `🔑 Password ${p.display_name}`, html: `
    <form class="ps-form">
      <p class="muted small">Login: kartu <b>${esc(p.display_name)}</b> di halaman depan + password ini.</p>
      <label>Password baru<input type="text" name="pw" minlength="6" maxlength="72" required autocomplete="off" spellcheck="false"></label>
      <button class="btn btn-block">Simpan password</button>
    </form>` });
  const f = m.body.querySelector('form');
  f.pw.focus();
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = f.querySelector('button'); btn.disabled = true;
    try {
      if (self) { const { error } = await sb.auth.updateUser({ password: f.pw.value }); if (error) throw error; }
      else await callAkun({ action: 'password', id: p.id, password: f.pw.value });
      m.close(); toast(`Password ${p.display_name} diganti`);
    } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
  };
}

function openForm(p = null, box = document.querySelector('#personel-sec')) {
  const edit = !!p;
  const m = modal({ title: edit ? `✏️ Edit ${p.display_name}` : '＋ Personel baru', html: `
    <form class="ps-form">
      <label>Nama tampilan<input name="nama" maxlength="30" required value="${esc(p?.display_name || '')}" placeholder="Contoh: Budi"></label>
      <label>Username <small class="muted">(huruf kecil/angka, 3–20)</small>
        <input name="user" maxlength="20" required value="${esc(p?.username || '')}" autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="budi"></label>
      ${edit ? '' : `
      <label>Password <small class="muted">(min. 6 karakter)</small><input type="text" name="pw" minlength="6" maxlength="72" required autocomplete="off" spellcheck="false"></label>
      <label>Tema awal<select name="theme">${THEMES.map(t => `<option value="${t.id}">${t.emoji} ${t.nama}</option>`).join('')}</select></label>
      <label class="switch"><span>🔒 Privat<br><span class="muted small">Tidak bisa dipantau & tidak bisa memantau orang lain</span></span>
        <input type="checkbox" name="privat"></label>`}
      <p class="muted small">Username dipakai di balik layar untuk login. Di halaman depan yang tampil adalah <b>nama tampilan</b>.</p>
      <button class="btn btn-block">${edit ? 'Simpan' : 'Buat akun'}</button>
    </form>` });
  const f = m.body.querySelector('form');
  f.user.oninput = () => { f.user.value = f.user.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''); };
  if (!edit) f.nama.oninput = () => { if (!f.user.dataset.touched) f.user.value = f.nama.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20); };
  f.user.addEventListener('keydown', () => { f.user.dataset.touched = 1; });
  f.nama.focus();
  f.onsubmit = async e => {
    e.preventDefault();
    const display_name = f.nama.value.trim(), username = f.user.value.trim();
    if (!USER_RE.test(username)) return toast('Username 3–20 karakter: huruf kecil, angka, titik, _ atau -', 'error');
    const btn = f.querySelector('button.btn-block'); btn.disabled = true; btn.textContent = 'Memproses…';
    try {
      if (edit) {
        const patch = { action: 'update', id: p.id };
        if (display_name !== p.display_name) patch.display_name = display_name;
        if (username !== p.username) patch.username = username;
        if (patch.display_name || patch.username) await callAkun(patch);
        toast('Tersimpan');
      } else {
        const { id } = await callAkun({ action: 'create', display_name, username, password: f.pw.value, theme: f.theme.value });
        if (f.privat.checked) await sb.from('profiles').update({ privat: true }).eq('id', id);
        sticker(`🎉 ${display_name} bergabung!`);
        toast(`Akun ${display_name} dibuat — login pakai kartu "${display_name}" + password tadi`);
      }
      m.close();
      await reload(box);
    } catch (err) { btn.disabled = false; btn.textContent = edit ? 'Simpan' : 'Buat akun'; toast(err.message, 'error'); }
  };
}
