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
