// =========================================================
// 🌙 Absen Tidur & Bangun + statistik — tampil di halaman Habit
// =========================================================
import { sb } from '../supabase.js';
import { state, assertCanEdit } from '../state.js';
import { toast, esc, modal } from '../ui.js';
import { sticker, celebrate } from '../fx.js';
import { ymd, parse, addDays, fmtShort, dayName } from '../date.js';

const QUALITY = { 1: '😫', 2: '😕', 3: '😐', 4: '🙂', 5: '😁' };
const DEF = { target_tidur: '23:00', target_bangun: '06:00', target_jam: 7.5, habit_tidur: null, habit_bangun: null };

// ---------- Helper waktu ----------
const minOfDay = d => d.getHours() * 60 + d.getMinutes();
const toMin = t => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + m; };
// Jam tidur dibandingkan relatif terhadap jam 12 siang, supaya 23:30 < 00:40 < 01:00
const relNoon = m => (m - 720 + 1440) % 1440;
const fromRelNoon = r => (Math.round(r) + 720) % 1440;
const hm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const timeOf = iso => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':');
const dur = mins => `${Math.floor(mins / 60)}j ${String(Math.round(mins % 60)).padStart(2, '0')}m`;
// Malam milik tanggal (waktu − 12 jam): tidur 00:40 tgl 17 → malam tgl 16
export const nightOf = d => ymd(new Date(d.getTime() - 12 * 3600e3));
const durMin = l => l.bangun_at ? (new Date(l.bangun_at) - new Date(l.tidur_at)) / 60000 : null;

export function sleepStats(logs, set, days) {
  const from = addDays(nightOf(new Date()), -days + 1);
  const done = logs.filter(l => l.bangun_at && l.malam >= from);
  if (!done.length) return null;
  const beds = done.map(l => relNoon(minOfDay(new Date(l.tidur_at))));
  const wakes = done.map(l => minOfDay(new Date(l.bangun_at)));
  const durs = done.map(durMin);
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const sd = a => { const m = avg(a); return Math.sqrt(avg(a.map(x => (x - m) ** 2))); };
  const tBed = relNoon(toMin(set.target_tidur)), tWake = toMin(set.target_bangun), tDur = Number(set.target_jam) * 60;
  const q = done.filter(l => l.kualitas);
  return {
    n: done.length,
    bed: fromRelNoon(avg(beds)), wake: avg(wakes), dur: avg(durs),
    sdBed: sd(beds), sdWake: sd(wakes),
    onBed: done.filter((l, i) => beds[i] <= tBed).length / done.length * 100,
    onWake: done.filter((l, i) => wakes[i] <= tWake).length / done.length * 100,
    debt: done.reduce((s, l, i) => s + Math.max(0, tDur - durs[i]), 0),
    enough: durs.filter(d => d >= tDur).length,
    quality: q.length ? avg(q.map(l => l.kualitas)) : null,
    best: done.reduce((a, l) => durMin(l) > durMin(a) ? l : a, done[0]),
    shortest: done.reduce((a, l) => durMin(l) < durMin(a) ? l : a, done[0])
  };
}

// ---------- Komponen ----------
export function createSleep(card, statsBox, { onHabitChange } = {}) {
  let logs = [], set = { ...DEF }, range = 14, timer, uid, CW = 640;

  async function load() {
    uid = state.viewing.id;
    const [l, s] = await Promise.all([
      sb.from('sleep_logs').select('*').eq('user_id', uid).gte('malam', addDays(nightOf(new Date()), -120)).order('malam', { ascending: false }),
      sb.from('sleep_settings').select('*').eq('user_id', uid).maybeSingle()
    ]);
    if (!card.isConnected) return;
    if (l.error) {
      // Tabel belum ada → SQL 07 belum dijalankan; sembunyikan diam-diam untuk orang lain, beri petunjuk untuk pemilik
      card.innerHTML = state.readOnly ? '' : `<p class="muted small">🌙 Absen tidur belum aktif — jalankan <b>07_tidur.sql</b> di Supabase.</p>`;
      statsBox.innerHTML = '';
      return;
    }
    logs = l.data.sort((a, b) => b.malam.localeCompare(a.malam)); set = { ...DEF, ...(s.data || {}) };
    set.target_tidur = String(set.target_tidur).slice(0, 5); set.target_bangun = String(set.target_bangun).slice(0, 5);
    draw();
  }

  const open = () => logs.find(l => !l.bangun_at && (Date.now() - new Date(l.tidur_at)) < 20 * 3600e3);

  function draw() { drawCard(); drawStats(); }

  function drawCard() {
    const o = open(), ro = state.readOnly, now = new Date();
    const last = logs.find(l => l.bangun_at);
    const tonight = logs.find(l => l.malam === nightOf(now));
    let body;
    if (o) {
      const mins = (now - new Date(o.tidur_at)) / 60000;
      body = `
        <div class="sl-state sleeping">
          <span class="sl-moon">😴</span>
          <div><b>${ro ? `${esc(state.viewing.display_name)} sedang tidur` : 'Sedang tidur'}</b>
            <span class="muted">sejak ${timeOf(o.tidur_at)} · <span id="sl-elapsed">${dur(mins)}</span></span></div>
        </div>
        <button class="btn sl-big wake" data-act="wake" data-edit>☀️ Check-in Bangun</button>`;
    } else {
      const doneTonight = tonight?.bangun_at;
      body = `
        <div class="sl-state">
          <span class="sl-moon">${doneTonight ? '☀️' : '🌙'}</span>
          <div>${last ? `<b>Tidur terakhir: ${dur(durMin(last))}</b>
            <span class="muted">${timeOf(last.tidur_at)} → ${timeOf(last.bangun_at)}${last.kualitas ? ' · ' + QUALITY[last.kualitas] : ''}</span>`
            : `<b>Belum ada catatan tidur</b><span class="muted">Tap tombol di bawah tepat sebelum tidur.</span>`}</div>
        </div>
        ${doneTonight ? '' : `<button class="btn sl-big" data-act="sleep" data-edit>😴 Check-in Tidur</button>`}`;
    }
    card.innerHTML = `
      <header class="sched-head">
        <h2>🌙 Tidur & Bangun</h2>
        <div class="sl-target muted small">Target 😴 ${set.target_tidur} · ☀️ ${set.target_bangun} · ${String(set.target_jam).replace('.', ',')} jam</div>
      </header>
      ${body}
      <div class="sl-links" data-edit>
        <button class="link-btn" data-act="manual">✏️ Isi / ubah manual</button>
        <button class="link-btn" data-act="settings">⚙️ Target & hubungkan habit</button>
      </div>`;
    card.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act, b));

    clearInterval(timer);
    if (o) timer = setInterval(() => {
      if (!card.isConnected) return clearInterval(timer);
      const e = card.querySelector('#sl-elapsed');
      if (e) e.textContent = dur((Date.now() - new Date(o.tidur_at)) / 60000);
    }, 30000);
  }

  async function act(a, btn) {
    try { assertCanEdit(); } catch (e) { return toast(e.message, 'error'); }
    if (a === 'sleep') return checkIn(btn);
    if (a === 'wake') return checkOut(btn);
    if (a === 'manual') return openManual();
    if (a === 'settings') return openSettings();
  }

  async function checkIn(btn) {
    const now = new Date(), malam = nightOf(now);
    const ex = logs.find(l => l.malam === malam);
    btn.disabled = true;
    const q = ex ? sb.from('sleep_logs').update({ tidur_at: now.toISOString(), bangun_at: null }).eq('id', ex.id).select().single()
                 : sb.from('sleep_logs').insert({ malam, tidur_at: now.toISOString() }).select().single();
    const { data, error } = await q;
    if (error) { btn.disabled = false; return toast('Gagal check-in: ' + error.message, 'error'); }
    logs = [data, ...logs.filter(l => l.id !== data.id)].sort((a, b) => b.malam.localeCompare(a.malam));
    const onTime = relNoon(minOfDay(now)) <= relNoon(toMin(set.target_tidur));
    draw();
    sticker(onTime ? '🌙 Selamat tidur!' : '😴 Selamat tidur…');
    if (!onTime) toast(`Lewat target ${set.target_tidur} — besok coba lebih awal ya 💪`);
    if (onTime && set.habit_tidur) await logHabit(set.habit_tidur, malam);
  }

  async function checkOut(btn) {
    const o = open(), now = new Date();
    btn.disabled = true;
    const { data, error } = await sb.from('sleep_logs').update({ bangun_at: now.toISOString() }).eq('id', o.id).select().single();
    if (error) { btn.disabled = false; return toast('Gagal check-in: ' + error.message, 'error'); }
    Object.assign(o, data);
    draw();
    const mins = durMin(o), onTime = minOfDay(now) <= toMin(set.target_bangun);
    if (onTime && mins >= Number(set.target_jam) * 60) { celebrate(); setTimeout(() => sticker(`☀️ ${dur(mins)} — tidur ideal!`), 600); }
    else sticker(`☀️ Pagi! Tidur ${dur(mins)}`);
    if (onTime && set.habit_bangun) await logHabit(set.habit_bangun, ymd(now));
    askQuality(o);
  }

  async function logHabit(habitId, tanggal) {
    const { error } = await sb.from('habit_logs').insert({ habit_id: habitId, tanggal });
    if (!error || /duplicate|unique/i.test(error.message)) onHabitChange?.();
  }

  function askQuality(l) {
    const m = modal({ title: '☀️ Selamat pagi! Gimana tidurnya?' });
    m.body.innerHTML = `
      <p class="muted">${timeOf(l.tidur_at)} → ${timeOf(l.bangun_at)} · <b>${dur(durMin(l))}</b></p>
      <div class="q-row">${Object.entries(QUALITY).map(([k, v]) => `<button class="q-btn" data-q="${k}" title="${['', 'Buruk', 'Kurang', 'Biasa', 'Nyenyak', 'Sangat nyenyak'][k]}">${v}</button>`).join('')}</div>
      <input class="q-note" maxlength="120" placeholder="Catatan (opsional): mimpi, terbangun malam, dll.">
      <div class="form-actions" style="margin-top:12px"><button class="btn btn-ghost btn-sm" data-close>Lewati</button></div>`;
    m.body.querySelectorAll('[data-q]').forEach(b => b.onclick = async () => {
      const patch = { kualitas: Number(b.dataset.q), catatan: m.body.querySelector('.q-note').value.trim() || null };
      const { error } = await sb.from('sleep_logs').update(patch).eq('id', l.id);
      if (error) return toast(error.message, 'error');
      Object.assign(l, patch); m.close(); draw();
    });
  }

  // ---------- Isi manual (lupa absen) ----------
  function openManual() {
    const now = new Date();
    const list = Array.from({ length: 7 }, (_, i) => addDays(nightOf(now), -i));
    const m = modal({ title: '✏️ Isi / ubah catatan tidur' });
    const render = (malam) => {
      const l = logs.find(x => x.malam === malam);
      const dflBed = l ? timeOf(l.tidur_at) : set.target_tidur, dflWake = l?.bangun_at ? timeOf(l.bangun_at) : set.target_bangun;
      m.body.innerHTML = `
        <form class="sched-form" autocomplete="off">
          <label>Malam<select name="malam">${list.map(d => `<option value="${d}" ${d === malam ? 'selected' : ''}>${dayName(d)}, ${fmtShort(d)} ${logs.some(x => x.malam === d) ? '✓' : ''}</option>`).join('')}</select></label>
          <div class="row">
            <label>😴 Jam tidur<input type="time" name="tidur" required value="${dflBed}"></label>
            <label>☀️ Jam bangun<input type="time" name="bangun" value="${dflWake}"></label>
          </div>
          <div class="field"><span class="field-label">Kualitas</span>
            <div class="chips">${Object.entries(QUALITY).map(([k, v]) => `<label class="chip"><input type="radio" name="q" value="${k}" ${l?.kualitas == k ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div></div>
          <p class="muted small" id="mn-prev"></p>
          <div class="form-actions"><button class="btn" type="submit">💾 Simpan</button>
            ${l ? '<button class="btn btn-ghost danger-text" type="button" data-act="del">🗑️ Hapus</button>' : ''}</div>
        </form>`;
      const f = m.body.querySelector('form');
      // Jam tidur sore/malam → tanggal malam itu; lewat tengah malam → tanggal berikutnya
      const toDates = () => {
        const [bh, bm] = f.tidur.value.split(':').map(Number);
        const bed = parse(malam); if (bh < 12) bed.setDate(bed.getDate() + 1); bed.setHours(bh, bm, 0, 0);
        let wake = null;
        if (f.bangun.value) { const [wh, wm] = f.bangun.value.split(':').map(Number); wake = new Date(bed); wake.setHours(wh, wm, 0, 0); if (wake <= bed) wake.setDate(wake.getDate() + 1); }
        return { bed, wake };
      };
      const prev = () => { const { bed, wake } = toDates(); f.querySelector('#mn-prev').textContent = wake ? `Durasi: ${dur((wake - bed) / 60000)}` : 'Belum bangun (masih tidur)'; };
      f.tidur.oninput = prev; f.bangun.oninput = prev; prev();
      f.malam.onchange = () => render(f.malam.value);
      f.onsubmit = async e => {
        e.preventDefault();
        const { bed, wake } = toDates();
        if (wake && wake - bed >= 20 * 3600e3) return toast('Durasi tidak masuk akal (lebih dari 20 jam)', 'error');
        if (wake && wake > new Date()) return toast('Jam bangun belum terjadi', 'error');
        const row = { malam, tidur_at: bed.toISOString(), bangun_at: wake ? wake.toISOString() : null, kualitas: f.q.value ? Number(f.q.value) : null };
        const q = l ? sb.from('sleep_logs').update(row).eq('id', l.id).select().single() : sb.from('sleep_logs').insert(row).select().single();
        const { data, error } = await q;
        if (error) return toast('Gagal menyimpan: ' + error.message, 'error');
        logs = [data, ...logs.filter(x => x.id !== data.id)].sort((a, b) => b.malam.localeCompare(a.malam));
        m.close(); draw(); toast('Catatan tidur tersimpan');
      };
      f.querySelector('[data-act=del]')?.addEventListener('click', async ev => {
        const b = ev.currentTarget;
        if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Klik lagi untuk hapus'; return; }
        const { error } = await sb.from('sleep_logs').delete().eq('id', l.id);
        if (error) return toast(error.message, 'error');
        logs = logs.filter(x => x !== l); m.close(); draw();
      });
    };
    render(list.find(d => !logs.some(x => x.malam === d && x.bangun_at)) || list[0]);
  }

  // ---------- Target & habit ----------
  async function openSettings() {
    const { data: habits } = await sb.from('habits').select('id,nama,icon').eq('user_id', state.me.id).eq('aktif', true).order('urutan');
    const m = modal({ title: '⚙️ Target tidur' });
    const opt = sel => `<option value="">— tidak dihubungkan —</option>` + (habits || []).map(h => `<option value="${h.id}" ${sel === h.id ? 'selected' : ''}>${esc(h.icon)} ${esc(h.nama)}</option>`).join('');
    m.body.innerHTML = `
      <form class="sched-form" autocomplete="off">
        <div class="row">
          <label>😴 Tidur paling lambat<input type="time" name="tt" required value="${set.target_tidur}"></label>
          <label>☀️ Bangun paling lambat<input type="time" name="tb" required value="${set.target_bangun}"></label>
          <label>⏱️ Durasi ideal (jam)<input type="number" name="tj" min="4" max="12" step="0.5" required value="${set.target_jam}"></label>
        </div>
        <h3 class="sched-list-title">Hubungkan ke habit</h3>
        <p class="muted small">Kalau check-in tepat waktu, habit ini otomatis tercentang.</p>
        <label>Habit tidur<select name="ht">${opt(set.habit_tidur)}</select></label>
        <label>Habit bangun<select name="hb">${opt(set.habit_bangun)}</select></label>
        <div class="form-actions"><button class="btn" type="submit">💾 Simpan</button></div>
      </form>`;
    const f = m.body.querySelector('form');
    f.ht.onchange = () => { // isi otomatis jam dari nama habit, misal "Tidur sebelum jam 01.00"
      const h = habits.find(x => x.id === f.ht.value), mt = h?.nama.match(/(\d{1,2})[.:](\d{2})/);
      if (mt) f.tt.value = `${mt[1].padStart(2, '0')}:${mt[2]}`;
    };
    f.onsubmit = async e => {
      e.preventDefault();
      const row = { user_id: state.me.id, target_tidur: f.tt.value, target_bangun: f.tb.value, target_jam: Number(f.tj.value),
        habit_tidur: f.ht.value || null, habit_bangun: f.hb.value || null, updated_at: new Date().toISOString() };
      const { error } = await sb.from('sleep_settings').upsert(row, { onConflict: 'user_id' });
      if (error) return toast('Gagal menyimpan: ' + error.message, 'error');
      set = { ...set, ...row }; m.close(); draw(); toast('Target tidur tersimpan');
    };
  }

  // ---------- Statistik ----------
  function drawStats() {
    const st = sleepStats(logs, set, range);
    if (!logs.some(l => l.bangun_at)) { statsBox.innerHTML = ''; return; }
    const tiles = st ? [
      ['😴', 'Rata-rata tidur', hm(st.bed), `konsistensi ±${Math.round(st.sdBed)} mnt`],
      ['☀️', 'Rata-rata bangun', hm(st.wake), `konsistensi ±${Math.round(st.sdWake)} mnt`],
      ['⏱️', 'Rata-rata durasi', dur(st.dur), `${st.enough}/${st.n} malam cukup`],
      ['🎯', 'Tidur tepat waktu', Math.round(st.onBed) + '%', `bangun tepat ${Math.round(st.onWake)}%`],
      ['💤', 'Utang tidur', dur(st.debt), `vs target ${String(set.target_jam).replace('.', ',')} jam/malam`],
      ['⭐', 'Kualitas', st.quality ? `${QUALITY[Math.round(st.quality)]} ${st.quality.toFixed(1).replace('.', ',')}` : '–', `dari ${st.n} malam tercatat`]
    ] : [];
    statsBox.innerHTML = `
      <header class="sched-head">
        <h2>📊 Statistik Tidur</h2>
        <div class="seg">${[7, 14, 30].map(n => `<button class="${range === n ? 'active' : ''}" data-r="${n}">${n} hari</button>`).join('')}</div>
      </header>
      ${st ? `
        <div class="sl-tiles">${tiles.map(([i, l, v, s]) => `<div class="sl-tile"><span>${i} ${l}</span><b>${v}</b><small class="muted">${s}</small></div>`).join('')}</div>
        ${chart()}
        <p class="muted small sl-ext">🏆 Terpanjang ${dur(durMin(st.best))} (${dayName(st.best.malam)} ${fmtShort(st.best.malam)}) · ⚠️ Terpendek ${dur(durMin(st.shortest))} (${dayName(st.shortest.malam)} ${fmtShort(st.shortest.malam)})</p>`
        : `<p class="muted">Belum ada data lengkap di ${range} hari terakhir.</p>`}`;
    statsBox.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { range = Number(b.dataset.r); drawStats(); });
    bindChart();
  }

  // Grafik rentang: tiap malam = 1 batang dari jam tidur sampai jam bangun (sumbu jam 18:00 → 14:00)
  function chart() {
    const nights = Array.from({ length: range }, (_, i) => addDays(nightOf(new Date()), -range + 1 + i));
    // Lebar grafik mengikuti layar supaya tulisan tetap terbaca di HP
    CW = Math.max(300, Math.min(900, (statsBox.clientWidth || 680) - 40));
    const W = CW, H = CW < 500 ? 240 : 260, P = { l: 40, r: 58, t: 12, b: 26 };
    const Y0 = 18 * 60, SPAN = 20 * 60;                        // 18:00 s/d 14:00 esok
    const y = m => P.t + ((m - Y0 + 1440) % 1440) / SPAN * (H - P.t - P.b);
    const bw = (W - P.l - P.r) / range;
    const ticks = [18, 21, 0, 3, 6, 9, 12].map(h => h * 60);
    const tb = toMin(set.target_tidur), tw = toMin(set.target_bangun);
    const bars = nights.map((d, i) => {
      const l = logs.find(x => x.malam === d && x.bangun_at);
      const x = P.l + i * bw;
      const lbl = (bw >= 22 || i % Math.ceil(22 / bw) === 0) ? `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" class="axis">${range <= 7 ? dayName(d) : parse(d).getDate()}</text>` : '';
      if (!l) return lbl;
      const a = minOfDay(new Date(l.tidur_at)), b = minOfDay(new Date(l.bangun_at));
      const y1 = y(a), y2 = Math.max(y(b), y1 + 3);
      return `${lbl}<rect x="${x + (bw - Math.min(bw * 0.64, 40)) / 2}" y="${y1}" width="${Math.min(bw * 0.64, 40)}" height="${y2 - y1}" rx="4" class="sl-bar ${durMin(l) < Number(set.target_jam) * 60 ? 'short' : ''}"
        data-tip="${dayName(d)} ${fmtShort(d)}|${timeOf(l.tidur_at)} → ${timeOf(l.bangun_at)}|${dur(durMin(l))}${l.kualitas ? ' · ' + QUALITY[l.kualitas] : ''}"/>`;
    }).join('');
    return `
      <div class="chart-wrap sl-chart">
        <svg viewBox="0 0 ${W} ${H}" class="line-chart" role="img" aria-label="Grafik jam tidur dan bangun ${range} hari">
          ${ticks.map(t => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${P.l - 6}" y="${y(t) + 4}" text-anchor="end" class="axis">${hm(t)}</text>`).join('')}
          <line x1="${P.l}" x2="${W - P.r}" y1="${y(tb)}" y2="${y(tb)}" class="target-line"/>
          <text x="${W - P.r + 4}" y="${y(tb) + 4}" class="axis tl">😴 ${hm(tb)}</text>
          <line x1="${P.l}" x2="${W - P.r}" y1="${y(tw)}" y2="${y(tw)}" class="target-line"/>
          <text x="${W - P.r + 4}" y="${y(tw) + 4}" class="axis tl">☀️ ${hm(tw)}</text>
          ${bars}
        </svg>
        <div class="chart-tip" hidden></div>
      </div>
      <p class="muted small">Tiap batang = 1 malam, dari jam tidur (atas) sampai jam bangun (bawah). Garis putus-putus = target. Batang pudar = tidur kurang dari target.</p>
      <details class="chart-table"><summary class="muted small">Lihat sebagai tabel</summary>
        <table class="set-table"><thead><tr><th>Malam</th><th>Tidur</th><th>Bangun</th><th>Durasi</th><th></th></tr></thead><tbody>
        ${logs.filter(l => l.bangun_at).slice(0, range).map(l => `<tr><td>${dayName(l.malam)} ${fmtShort(l.malam)}</td><td>${timeOf(l.tidur_at)}</td><td>${timeOf(l.bangun_at)}</td><td>${dur(durMin(l))}</td><td>${l.kualitas ? QUALITY[l.kualitas] : ''}</td></tr>`).join('')}
        </tbody></table></details>`;
  }

  function bindChart() {
    const svg = statsBox.querySelector('svg'), tip = statsBox.querySelector('.chart-tip');
    if (!svg) return;
    svg.querySelectorAll('.sl-bar').forEach(r => {
      const show = () => {
        const [a, b, c] = r.dataset.tip.split('|');
        const box = svg.getBoundingClientRect(), sc = box.width / CW;
        tip.innerHTML = `<b>${a}</b><span>${b}</span><span>${c}</span>`;
        tip.style.left = (Number(r.getAttribute('x')) + Number(r.getAttribute('width')) / 2) * sc + 'px';
        tip.style.top = Number(r.getAttribute('y')) * sc + 'px';
        tip.hidden = false;
        svg.querySelectorAll('.sl-bar.on').forEach(x => x.classList.remove('on')); r.classList.add('on');
      };
      r.addEventListener('pointerenter', show); r.addEventListener('click', show);
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; svg.querySelectorAll('.sl-bar.on').forEach(x => x.classList.remove('on')); });
  }

  return { load };
}
