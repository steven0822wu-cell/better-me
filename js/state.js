// State global: siapa yang login (me) dan data siapa yang sedang dilihat (viewing)
export const state = {
  me: null,          // profile user login
  other: null,       // profile pasangan
  viewing: null,     // profile yang datanya sedang ditampilkan
  get readOnly() { return this.viewing && this.me && this.viewing.id !== this.me.id; }
};

const listeners = new Set();
export const onChange = fn => listeners.add(fn);

export function setViewing(profile) {
  state.viewing = profile;
  document.body.classList.toggle('read-only', state.readOnly);
  listeners.forEach(fn => fn(state));
}

// Guard untuk semua aksi tulis di modul
export function assertCanEdit() {
  if (state.readOnly) throw new Error(`Mode pantau: data ${state.viewing.display_name} tidak bisa diedit`);
}
