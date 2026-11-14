import { state } from '../state.js';

const SAPAAN = () => {
  const h = new Date().getHours();
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 18) return 'Selamat sore';
  return 'Selamat malam';
};

export default {
  render(el) {
    const v = state.viewing;
    const tgl = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const judul = state.readOnly
      ? `Hari ini ${v.display_name}`
      : `${SAPAAN()}, ${v.display_name}`;

    el.innerHTML = `
      <section class="hero-block">
        <p class="eyebrow">${tgl}</p>
        <h1>${judul}</h1>
        <p class="muted">Satu langkah kecil tiap hari → better me.</p>
      </section>

      <div class="grid">
        ${tile('✅', 'Habit hari ini', '—', 'habit')}
        ${tile('📝', 'To-do hari ini', '—', 'todo')}
        ${tile('🏋️', 'Latihan terakhir', '—', 'gym')}
        ${tile('💰', 'Saldo bulan ini', '—', 'finance')}
        ${tile('📈', 'Portofolio', '—', 'invest')}
        ${tile('🎯', 'Target aktif', '—', 'target')}
        ${tile('🎁', 'Wishlist', '—', 'wishlist')}
      </div>`;
  }
};

function tile(icon, label, value, route) {
  return `
    <a class="card tile" href="#/${route}">
      <span class="tile-icon">${icon}</span>
      <span class="tile-label">${label}</span>
      <span class="tile-value">${value}</span>
    </a>`;
}
