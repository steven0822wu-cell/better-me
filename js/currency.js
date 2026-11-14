import { sb } from './supabase.js';

let usdIdr = null;

// Ambil kurs USD→IDR: pakai cache DB hari ini, kalau belum ada fetch API publik lalu simpan
export async function getUsdIdr() {
  if (usdIdr) return usdIdr;
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await sb.from('fx_rates').select('rate,tanggal')
    .eq('pair', 'USDIDR').order('tanggal', { ascending: false }).limit(1);
  if (data?.[0] && data[0].tanggal === today) return (usdIdr = Number(data[0].rate));

  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const j = await r.json();
    const rate = j?.rates?.IDR;
    if (rate) {
      await sb.from('fx_rates').upsert({ tanggal: today, pair: 'USDIDR', rate });
      return (usdIdr = rate);
    }
  } catch (e) { console.warn('Gagal ambil kurs', e); }
  return (usdIdr = data?.[0] ? Number(data[0].rate) : 16000); // fallback
}

// Harga crypto (USD) dari CoinGecko. ids: ['bitcoin','ethereum']
export async function getCryptoUsd(ids) {
  if (!ids.length) return {};
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`);
  const j = await r.json();
  return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v.usd]));
}

const fmtIdr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const fmtUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

// Format nilai IDR sesuai pilihan tampilan user
export function money(idr, view = 'IDR') {
  if (view === 'USD' && usdIdr) return fmtUsd.format(idr / usdIdr);
  return fmtIdr.format(idr);
}
