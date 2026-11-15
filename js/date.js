// Helper tanggal lokal (YYYY-MM-DD) — hindari toISOString() yang pakai UTC
export const ymd = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const today = () => ymd(new Date());

export const parse = s => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (s, n) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};

// Senin sebagai awal minggu
export const weekStart = s => {
  const d = parse(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(d);
};

export function relLabel(s) {
  const t = today();
  if (s === t) return 'Hari ini';
  if (s === addDays(t, 1)) return 'Besok';
  if (s === addDays(t, -1)) return 'Kemarin';
  return parse(s).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
}

export const fmtLong = s =>
  parse(s).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const fmtShort = s => parse(s).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

export const dayName = s => parse(s).toLocaleDateString('id-ID', { weekday: 'short' });
