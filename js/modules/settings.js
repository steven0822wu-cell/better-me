import { sb } from '../supabase.js';
import { state } from '../state.js';
import { THEMES, applyTheme } from '../theme.js';
import { logout } from '../auth.js';
import { toast } from '../ui.js';

// Pengaturan selalu milik user login sendiri (tidak terpengaruh mode pantau)
export default {
  render(el) {
    const me = state.me;
    el.innerHTML = `
      <h1 class="page-title">Pengaturan</h1>

      <section class="card">
        <h2>Tema</h2>
        <p class="muted">Tema kamu sendiri — ${state.other ? state.other.display_name : 'pasangan'} punya pilihannya sendiri.</p>
        <div class="theme-grid">
          ${THEMES.map(t => `
            <button class="theme-opt ${me.theme === t.id ? 'active' : ''}" data-theme-id="${t.id}">
              <span class="swatch" data-theme="${t.id}">
                <i class="sw-bg"></i><i class="sw-primary"></i><i class="sw-accent"></i>
              </span>
              <span class="theme-name">${t.emoji} ${t.nama}</span>
              <span class="theme-desc">${t.desc}</span>
            </button>`).join('')}
        </div>
      </section>

      <section class="card">
        <h2>Tampilan mata uang</h2>
        <div class="seg">
          ${['IDR', 'USD'].map(c => `
            <button class="${me.currency_view === c ? 'active' : ''}" data-cur="${c}">${c}</button>`).join('')}
        </div>
        <p class="muted small">Data tetap disimpan dalam IDR, hanya tampilannya yang dikonversi.</p>
      </section>

      <section class="card">
        <h2>Akun</h2>
        <p>Masuk sebagai <b>${me.display_name}</b></p>
        <button class="btn btn-ghost" id="btn-logout">Keluar</button>
      </section>`;

    el.querySelectorAll('[data-theme-id]').forEach(b => b.onclick = async () => {
      const id = b.dataset.themeId;
      applyTheme(id);
      await save({ theme: id });
      el.querySelectorAll('.theme-opt').forEach(x => x.classList.toggle('active', x === b));
    });

    el.querySelectorAll('[data-cur]').forEach(b => b.onclick = async () => {
      await save({ currency_view: b.dataset.cur });
      el.querySelectorAll('[data-cur]').forEach(x => x.classList.toggle('active', x === b));
    });

    el.querySelector('#btn-logout').onclick = logout;
  }
};

async function save(patch) {
  const { error } = await sb.from('profiles').update(patch).eq('id', state.me.id);
  if (error) return toast('Gagal menyimpan: ' + error.message, 'error');
  Object.assign(state.me, patch);
  toast('Tersimpan');
}
