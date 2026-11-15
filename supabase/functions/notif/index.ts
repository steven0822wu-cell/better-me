// @ts-nocheck
// =========================================================
// BETTER ME — Edge Function "notif"
// Pengirim notifikasi pengingat (Web Push). Dipanggil pg_cron tiap 5 menit.
// Cara pasang: lihat PANDUAN-NOTIFIKASI. Jangan ubah nama fungsi ("notif").
// =========================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

// ============ LOGIKA PENGINGAT (murni, tanpa database) ============

export const DEFAULTS = {
  pagi:         { on: true, time: '06:30' },
  jadwal:       { on: true, before: 15 },
  habit:        { on: true },
  streak:       { on: true, time: '21:00', min: 3 },
  todo_penting: { on: true, time: '17:00' },
  gym:          { on: true, time: '18:00', days: 3 },
  budget:       { on: true },
  lupa_catat:   { on: true, time: '21:00' },
  rekap:        { on: true, time: '08:00' },
  invest:       { on: true, time: '19:00' },
  target:       { on: true, time: '08:00' },
  wishlist:     { on: true }
};

export function mergePrefs(p) {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = { ...DEFAULTS[k], ...((p || {})[k] || {}) };
  return out;
}

// Waktu lokal di zona user → { date: 'YYYY-MM-DD', time: 'HH:MM', min, dow (1=Sen..7=Min), day }
export function localParts(tz, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short'
  }).formatToParts(d).map(x => [x.type, x.value]));
  const hh = p.hour === '24' ? '00' : p.hour;
  return {
    date: `${p.year}-${p.month}-${p.day}`, time: `${hh}:${p.minute}`,
    min: Number(hh) * 60 + Number(p.minute),
    dow: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1,
    day: Number(p.day)
  };
}

export const toMin = t => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + m; };
export const hhmm = t => String(t || '').slice(0, 5);
export function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const weekStart = s => { const d = new Date(s + 'T00:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; return addDays(s, -dow); };
export const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
export const rp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export function inQuiet(nowMin, start, end) {
  const s = toMin(start), e = toMin(end);
  if (s === e) return false;
  return s < e ? nowMin >= s && nowMin < e : nowMin >= s || nowMin < e;
}

// Jam pengingat jatuh tempo: dalam 60 menit setelah jam yang diatur
const dueAt = (now, t) => now.min >= toMin(t) && now.min < toMin(t) + 60;

function streakOf(set, h, today) {
  if (h.frekuensi === 'harian') {
    let d = set.has(today) ? today : addDays(today, -1), n = 0;
    while (set.has(d)) { n++; d = addDays(d, -1); }
    return n;
  }
  const wc = ws => { let n = 0; for (let i = 0; i < 7; i++) if (set.has(addDays(ws, i))) n++; return n; };
  let ws = weekStart(today), n = 0;
  if (wc(ws) < h.target_per_minggu) ws = addDays(ws, -7);
  while (wc(ws) >= h.target_per_minggu) { n++; ws = addDays(ws, -7); }
  return n;
}

/**
 * data: { nama, todos, schedules, habits, habitLogs, lastWorkout, accounts, categories,
 *         budgets, transactions, investments, investTxns, investPrices, targets, wishlist }
 * return: [{ key, title, body, url, ignoreQuiet, urgent }]
 */
export function plan(data, prefsRaw, now) {
  const P = mergePrefs(prefsRaw), out = [], today = now.date;
  const add = (key, title, body, url, extra = {}) => out.push({ key, title, body, url, ...extra });

  // Bantuan habit
  const logs = new Map();
  for (const l of data.habitLogs || []) {
    if (!logs.has(l.habit_id)) logs.set(l.habit_id, new Set());
    logs.get(l.habit_id).add(l.tanggal);
  }
  const habits = (data.habits || []).filter(h => h.aktif);
  const doneToday = h => logs.get(h.id)?.has(today);
  const weekCount = h => { const s = logs.get(h.id) || new Set(), ws = weekStart(today); let n = 0; for (let i = 0; i < 7; i++) if (s.has(addDays(ws, i))) n++; return n; };
  const habitDue = h => h.frekuensi === 'harian' || weekCount(h) < h.target_per_minggu;

  // Jadwal hari ini
  const schedToday = (data.schedules || [])
    .filter(s => s.aktif && (s.hari || []).includes(now.dow) && s.berlaku_mulai <= today && (!s.berlaku_sampai || today <= s.berlaku_sampai))
    .sort((a, b) => toMin(a.jam_mulai) - toMin(b.jam_mulai));

  const todos = data.todos || [];
  const todayTodos = todos.filter(t => t.tanggal === today);
  const openToday = todayTodos.filter(t => !t.done);
  const overdue = todos.filter(t => t.tanggal < today && !t.done);

  // 1. Ringkasan pagi
  if (P.pagi.on && dueAt(now, P.pagi.time)) {
    const parts = [];
    if (openToday.length || overdue.length) parts.push(`📝 ${openToday.length} to-do${overdue.length ? ` (+${overdue.length} tertunda)` : ''}`);
    if (schedToday.length) parts.push(`🗓️ ${schedToday.length} jadwal, mulai ${hhmm(schedToday[0].jam_mulai)}`);
    const hd = habits.filter(habitDue).length;
    if (hd) parts.push(`✅ ${hd} habit`);
    add(`pagi:${today}`, `☀️ Selamat pagi, ${data.nama}!`,
      parts.length ? parts.join(' · ') : 'Hari ini masih kosong — tulis satu hal kecil yang mau kamu capai.', '#/todo');
  }

  // 2. Jadwal rutin (X menit sebelum) — tetap dikirim saat jam tenang
  if (P.jadwal.on) {
    for (const s of schedToday) {
      const start = toMin(s.jam_mulai), left = start - now.min;
      if (left > 0 && left <= Number(P.jadwal.before)) {
        add(`jadwal:${s.id}:${today}`, `${s.icon || '⏰'} ${hhmm(s.jam_mulai)} · ${s.judul}`,
          `${left} menit lagi${s.jam_selesai ? ` (sampai ${hhmm(s.jam_selesai)})` : ''}${s.lokasi ? ` · 📍 ${s.lokasi}` : ''}`,
          '#/todo', { ignoreQuiet: true, urgent: true });
      }
    }
  }

  // 3. Habit per jam pengingat (hanya kalau belum dicentang)
  if (P.habit.on) {
    for (const h of habits) {
      if (!h.jam_pengingat || doneToday(h) || !habitDue(h) || !dueAt(now, h.jam_pengingat)) continue;
      const st = streakOf(logs.get(h.id) || new Set(), h, today);
      add(`habit:${h.id}:${today}`, `${h.icon || '✅'} ${h.nama}`,
        st ? `Belum dicentang hari ini — jaga streak 🔥 ${st} ${h.frekuensi === 'harian' ? 'hari' : 'minggu'}!` : 'Belum dicentang hari ini. Yuk, sekarang!', '#/habit', { ignoreQuiet: true });   // jam dipilih sendiri → tetap dikirim walau jam tenang
    }
  }

  // 4. Streak hampir putus
  if (P.streak.on && dueAt(now, P.streak.time)) {
    const risk = habits.filter(h => h.frekuensi === 'harian' && !doneToday(h) && !(P.habit.on && h.jam_pengingat)) // yang punya jam sendiri sudah diingatkan
      .map(h => ({ h, s: streakOf(logs.get(h.id) || new Set(), h, today) }))
      .filter(x => x.s >= Number(P.streak.min)).sort((a, b) => b.s - a.s);
    if (risk.length) add(`streak:${today}`, '🔥 Jangan putus streak!',
      risk.slice(0, 3).map(x => `${x.h.icon || ''} ${x.h.nama} (${x.s} hari)`).join(', ') + (risk.length > 3 ? ` +${risk.length - 3} lagi` : '') + ' belum dicentang.', '#/habit');
  }

  // 5. To-do penting belum selesai
  if (P.todo_penting.on && dueAt(now, P.todo_penting.time)) {
    const imp = openToday.filter(t => t.prioritas === 1);
    if (imp.length) add(`todo_penting:${today}`, `🔥 ${imp.length} tugas penting belum selesai`,
      imp.slice(0, 3).map(t => t.judul).join(' · ') + (imp.length > 3 ? ` +${imp.length - 3}` : ''), '#/todo');
  }

  // 6. Lama tidak latihan
  if (P.gym.on && data.lastWorkout && dueAt(now, P.gym.time)) {
    const n = daysBetween(data.lastWorkout, today);
    if (n >= Number(P.gym.days)) add(`gym:${today}`, `💪 Udah ${n} hari tanpa latihan`, 'Gerak sedikit hari ini? Jalan kaki 15 menit juga dihitung!', '#/gym');
  }

  // Finance
  const month = today.slice(0, 7);
  const txns = data.transactions || [];
  const cat = id => (data.categories || []).find(c => c.id === id);

  // 7. Budget menipis / terlewati (sekali per level per bulan)
  if (P.budget.on) {
    for (const b of (data.budgets || []).filter(x => x.bulan === month)) {
      const spent = txns.filter(t => t.tipe === 'out' && t.category_id === b.category_id && t.tanggal.startsWith(month))
        .reduce((s, t) => s + Number(t.jumlah_idr), 0);
      const lim = Number(b.limit_idr), c = cat(b.category_id), nm = c ? `${c.icon || ''} ${c.nama}`.trim() : 'kategori';
      if (spent > lim) add(`budget100:${b.category_id}:${month}`, `⚠️ Budget ${nm} terlewati`, `${rp(spent)} dari ${rp(lim)} — lewat ${rp(spent - lim)}.`, '#/finance');
      else if (spent >= lim * 0.8) add(`budget80:${b.category_id}:${month}`, `⚡ Budget ${nm} tinggal ${rp(lim - spent)}`, `Sudah terpakai ${Math.round(spent / lim * 100)}% bulan ini.`, '#/finance');
    }
  }

  // 8. Lupa mencatat
  if (P.lupa_catat.on && (data.accounts || []).length && dueAt(now, P.lupa_catat.time)) {
    if (!txns.some(t => t.tanggal === today)) add(`lupa_catat:${today}`, '🧾 Ada pengeluaran hari ini?', 'Belum ada transaksi tercatat hari ini. Catat sekarang biar tidak lupa.', '#/finance');
  }

  // 9. Rekap bulanan (tanggal 1)
  if (P.rekap.on && now.day === 1 && dueAt(now, P.rekap.time)) {
    const prev = addDays(today, -1).slice(0, 7);
    const pt = txns.filter(t => t.tanggal.startsWith(prev));
    if (pt.length) {
      const inc = pt.filter(t => t.tipe === 'in').reduce((s, t) => s + Number(t.jumlah_idr), 0);
      const exp = pt.filter(t => t.tipe === 'out').reduce((s, t) => s + Number(t.jumlah_idr), 0);
      add(`rekap:${prev}`, `📊 Rekap ${BULAN[Number(prev.slice(5)) - 1]}`,
        `Masuk ${rp(inc)} · Keluar ${rp(exp)} · ${inc - exp >= 0 ? 'Sisa +' : 'Minus '}${rp(Math.abs(inc - exp))}`, '#/finance');
    }
  }

  // 10. Harga investasi belum diupdate (Minggu)
  if (P.invest.on && now.dow === 7 && dueAt(now, P.invest.time)) {
    const stale = [];
    for (const a of (data.investments || []).filter(x => x.currency !== 'CRYPTO')) {
      const tx = (data.investTxns || []).filter(t => t.investment_id === a.id);
      const units = tx.reduce((u, t) => u + (t.tipe === 'beli' ? 1 : -1) * Number(t.unit), 0);
      if (units <= 1e-9) continue;
      const last = [...tx.map(t => t.tanggal), ...(data.investPrices || []).filter(p => p.investment_id === a.id).map(p => p.tanggal)].sort().pop();
      if (last && daysBetween(last, today) >= 7) stale.push(a.nama);
    }
    if (stale.length) add(`invest:${today}`, '📈 Update harga investasi', `${stale.slice(0, 3).join(', ')}${stale.length > 3 ? ` +${stale.length - 3}` : ''} terakhir diupdate lebih dari seminggu lalu.`, '#/invest');
  }

  // 11. Deadline target (H-7, H-1, hari H)
  if (P.target.on && dueAt(now, P.target.time)) {
    for (const t of (data.targets || []).filter(x => x.status === 'aktif' && x.deadline)) {
      const n = daysBetween(today, t.deadline);
      if (![7, 1, 0].includes(n)) continue;
      const pct = Number(t.nilai_target) ? Math.min(100, Math.round(Number(t.nilai_sekarang) / Number(t.nilai_target) * 100)) : null;
      add(`target${n}:${t.id}`, `🎯 ${t.judul}`, `${n === 0 ? 'Deadline hari ini!' : n === 1 ? 'Deadline besok!' : 'Deadline 7 hari lagi.'}${pct !== null ? ` Progres ${pct}%.` : ''}`, '#/target');
    }
  }

  // 12. Wishlist dana cukup (sekali per barang)
  if (P.wishlist.on) {
    for (const w of (data.wishlist || []).filter(x => x.status !== 'terbeli' && Number(x.harga_idr) > 0)) {
      if (Number(w.dana_terkumpul) >= Number(w.harga_idr)) add(`wishlist:${w.id}`, '🎉 Dana wishlist cukup!', `${w.nama} siap dibeli (${rp(w.harga_idr)}).`, '#/wishlist');
    }
  }

  return out;
}

// Saring: yang sudah pernah dikirim & jam tenang
export function filterReminders(list, sentKeys, settings, now) {
  const quiet = inQuiet(now.min, settings.quiet_start || '23:00', settings.quiet_end || '06:00');
  return list.filter(r => !sentKeys.has(r.key) && (!quiet || r.ignoreQuiet));
}

// ============ SERVER: ambil data, kirim Web Push ============

const SB_URL = Deno.env.get('SUPABASE_URL');
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const APP_URL = 'https://steven0822wu-cell.github.io/better-me/app.html';
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function getConfig(key) {
  const { data } = await sb.from('push_config').select('value').eq('key', key).maybeSingle();
  return data?.value || null;
}

// Kunci VAPID dibuat otomatis sekali, disimpan di push_config (tidak bisa dibaca dari app)
let vapidReady = null;
async function ensureVapid() {
  if (vapidReady) return vapidReady;
  let pub = await getConfig('vapid_public'), priv = await getConfig('vapid_private');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    const { error } = await sb.from('push_config').insert([
      { key: 'vapid_public', value: k.publicKey }, { key: 'vapid_private', value: k.privateKey }
    ]);
    if (error) { pub = await getConfig('vapid_public'); priv = await getConfig('vapid_private'); } // dibuat proses lain
    else { pub = k.publicKey; priv = k.privateKey; }
  }
  webpush.setVapidDetails('https://steven0822wu-cell.github.io', pub, priv);
  vapidReady = { pub };
  return vapidReady;
}

async function sendTo(subs, payload, urgent) {
  let ok = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload), { TTL: urgent ? 900 : 3600 * 6, urgency: urgent ? 'high' : 'normal' });
      ok++;
    } catch (e) {
      // Langganan kedaluwarsa / dicabut → hapus
      if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from('push_subscriptions').delete().eq('id', s.id);
      else console.error('push gagal', e?.statusCode, e?.body || e?.message);
    }
  }
  return ok;
}

async function userFromRequest(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await sb.auth.getUser(token);
  return data?.user || null;
}

async function loadUserData(uid, now) {
  const since = addDays(now.date, -70);
  const prevMonthStart = addDays(now.date.slice(0, 7) + '-01', -1).slice(0, 7) + '-01';
  const q = (t, cols = '*') => sb.from(t).select(cols).eq('user_id', uid);
  const [prof, td, ov, sc, hb, hl, wk, ac, ct, bg, tx, iv, it, ip, tg, ws] = await Promise.all([
    sb.from('profiles').select('display_name').eq('id', uid).maybeSingle(),
    q('todos', 'id,judul,tanggal,prioritas,done').eq('tanggal', now.date),
    q('todos', 'id,judul,tanggal,prioritas,done').lt('tanggal', now.date).eq('done', false).limit(200),
    q('schedules').eq('aktif', true),
    q('habits').eq('aktif', true),
    q('habit_logs', 'habit_id,tanggal').gte('tanggal', since).limit(5000),
    q('workouts', 'tanggal').order('tanggal', { ascending: false }).limit(1),
    q('accounts', 'id').eq('aktif', true),
    q('fin_categories', 'id,nama,icon'),
    q('budgets').eq('bulan', now.date.slice(0, 7)),
    q('transactions', 'tipe,jumlah_idr,tanggal,category_id').gte('tanggal', prevMonthStart).limit(5000),
    q('investments', 'id,nama,currency'),
    q('invest_txns', 'investment_id,tipe,unit,tanggal').limit(5000),
    q('invest_prices', 'investment_id,tanggal').gte('tanggal', since).limit(5000),
    q('targets', 'id,judul,deadline,status,nilai_target,nilai_sekarang'),
    q('wishlist', 'id,nama,harga_idr,dana_terkumpul,status').neq('status', 'terbeli')
  ]);
  return {
    nama: prof.data?.display_name || '',
    todos: [...(td.data || []), ...(ov.data || [])],
    schedules: sc.data || [], habits: hb.data || [], habitLogs: hl.data || [],
    lastWorkout: wk.data?.[0]?.tanggal || null,
    accounts: ac.data || [], categories: ct.data || [], budgets: bg.data || [], transactions: tx.data || [],
    investments: iv.data || [], investTxns: it.data || [], investPrices: ip.data || [],
    targets: tg.data || [], wishlist: ws.data || []
  };
}

async function runAll() {
  await ensureVapid();
  const [{ data: settings }, { data: subs }] = await Promise.all([
    sb.from('notif_settings').select('*').eq('enabled', true),
    sb.from('push_subscriptions').select('*')
  ]);
  const report = [];
  for (const st of settings || []) {
    const mySubs = (subs || []).filter(s => s.user_id === st.user_id);
    if (!mySubs.length) continue;
    const now = localParts(st.tz || 'Asia/Jakarta');
    const data = await loadUserData(st.user_id, now);
    const planned = plan(data, st.prefs, now);
    if (!planned.length) continue;
    const { data: sent } = await sb.from('notif_log').select('key').eq('user_id', st.user_id).in('key', planned.map(p => p.key));
    const todo = filterReminders(planned, new Set((sent || []).map(r => r.key)), st, now).slice(0, 6);
    for (const r of todo) {
      const ok = await sendTo(mySubs, { title: r.title, body: r.body, url: APP_URL + r.url, tag: r.key.split(':')[0] }, r.urgent);
      if (ok) await sb.from('notif_log').upsert({ user_id: st.user_id, key: r.key, title: r.title, body: r.body }, { onConflict: 'user_id,key', ignoreDuplicates: true });
      report.push({ user: data.nama, key: r.key, ok });
    }
  }
  return report;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  let body = {};
  try { body = await req.json(); } catch { /* kosong */ }

  try {
    // Kunci publik untuk berlangganan (aman dibagikan)
    if (body.action === 'vapid') return json({ publicKey: (await ensureVapid()).pub });

    // Kirim notifikasi tes ke perangkat user yang login
    if (body.action === 'test') {
      const user = await userFromRequest(req);
      if (!user) return json({ error: 'Harus login' }, 401);
      await ensureVapid();
      const { data: subs } = await sb.from('push_subscriptions').select('*').eq('user_id', user.id);
      if (!subs?.length) return json({ error: 'Belum ada perangkat yang aktif' }, 400);
      const ok = await sendTo(subs, { title: '🔔 Notifikasi aktif!', body: 'Pengingat Better Me akan muncul seperti ini.', url: APP_URL + '#/settings', tag: 'test' }, true);
      return json({ sent: ok, devices: subs.length });
    }

    // Pratinjau: pengingat apa yang jatuh tempo sekarang (tanpa mengirim)
    if (body.action === 'preview') {
      const user = await userFromRequest(req);
      if (!user) return json({ error: 'Harus login' }, 401);
      const { data: st } = await sb.from('notif_settings').select('*').eq('user_id', user.id).maybeSingle();
      const now = localParts(st?.tz || 'Asia/Jakarta');
      const data = await loadUserData(user.id, now);
      return json({ now, planned: plan(data, st?.prefs, now) });
    }

    // Dipanggil penjadwal (pg_cron) tiap 5 menit
    if (body.action === 'run') {
      const key = req.headers.get('x-cron-key');
      if (!key || key !== await getConfig('cron_key')) return json({ error: 'forbidden' }, 403);
      return json({ ok: true, sent: await runAll() });
    }

    return json({ error: 'aksi tidak dikenal' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
