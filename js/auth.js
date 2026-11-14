import { sb } from './supabase.js';

export async function login(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function logout() {
  await sb.auth.signOut();
  location.href = 'index.html';
}

// Dipanggil di app.html — lempar ke login kalau belum masuk
export async function requireSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.href = 'index.html'; return null; }
  return session;
}

export async function loadProfiles() {
  const { data, error } = await sb.from('profiles').select('*');
  if (error) throw error;
  return data;
}
