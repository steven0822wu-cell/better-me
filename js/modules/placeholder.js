const FASE = {
  todo: 2, habit: 2, finance: 3, wishlist: 3, gym: 4, invest: 5, target: 6
};

export function placeholder(route) {
  return {
    render(el) {
      el.innerHTML = `
        <section class="card empty">
          <div class="empty-icon">🚧</div>
          <h2>Segera hadir</h2>
          <p class="muted">Modul ini dibangun di <b>Fase ${FASE[route] ?? '-'}</b>.</p>
        </section>`;
    }
  };
}
