// =========================================================
// Notifikasi HP (Web Push) — sisi app
// =========================================================
import { sb } from './supabase.js';

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function call(action) {
  const { data, error } = await sb.functions.invoke('notif', { body: { action } });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json(); if (j?.error) msg = j.error; } catch {}
    if (/Failed to send|fetch|404|not found/i.test(msg)) msg = 'Edge Function "notif" belum terpasang atau tidak bisa dihubungi';
    throw new Error(msg);
  }
  return data;
}

async function registration() {
  return navigator.serviceWorker.getRegistration() || navigator.serviceWorker.register('sw.js');
}

// Status perangkat ini: 'unsupported' | 'need-install' | 'denied' | 'on' | 'off'
export async function deviceStatus() {
  if (isIOS() && !isStandalone()) return 'need-install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enable() {
  if (!supported()) throw new Error('Browser ini tidak mendukung notifikasi');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Izin notifikasi ditolak' : 'Izin notifikasi belum diberikan');
  const { publicKey } = await call('vapid');
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // Kalau kunci server berubah, langganan lama harus diganti
  if (sub && sub.options?.applicationServerKey) {
    const cur = new Uint8Array(sub.options.applicationServerKey);
    const want = b64ToBytes(publicKey);
    if (cur.length !== want.length || cur.some((b, i) => b !== want[i])) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  await saveSubscription(sub);
  return sub;
}

async function saveSubscription(sub) {
  const j = sub.toJSON();
  const { error } = await sb.rpc('claim_push_subscription', {
    p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent.slice(0, 200)
  });
  if (error) throw new Error(/function|schema cache/i.test(error.message) ? 'SQL notifikasi (05_notifikasi.sql) belum dijalankan' : error.message);
}

export async function disable() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

// Dipanggil saat app dibuka: pastikan langganan perangkat ini tercatat untuk user yang login
export async function syncSubscription() {
  try {
    if (!supported() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await saveSubscription(sub);
  } catch { /* diam saja */ }
}

export const sendTest = () => call('test');
export const preview = () => call('preview');
