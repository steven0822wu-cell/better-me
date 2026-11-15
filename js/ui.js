// toast('Tersimpan')
// toast('Dihapus', 'ok', { action: 'Batal', onAction: () => ..., duration: 4000 })
export function toast(msg, type = 'ok', opts = {}) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);

  const duration = opts.duration ?? 2400;
  if (opts.action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = opts.action;
    b.onclick = () => { opts.onAction?.(); close(); };
    t.appendChild(b);
  }
  box.appendChild(t);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    t.classList.add('out');
    setTimeout(() => t.remove(), 400);
  }
  setTimeout(close, duration);
  return close;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// modal({ title, html, onClose }) → { el, body, close }
export function modal({ title, html = '', onClose } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="Tutup">✕</button>
      </header>
      <div class="modal-body">${html}</div>
    </div>`;
  document.body.appendChild(back);
  document.body.classList.add('modal-open');

  const close = () => {
    back.classList.add('out');
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => back.remove(), 200);
    onClose?.();
  };
  const onKey = e => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });

  return { el: back, body: back.querySelector('.modal-body'), close };
}
