// Supabase membatasi 1000 baris per request — ambil semua halaman
// pakai: const { data, error } = await fetchAll(() => sb.from('x').select('*').eq(...))
export async function fetchAll(build, page = 1000) {
  let out = [], from = 0;
  for (;;) {
    const { data, error } = await build().range(from, from + page - 1);
    if (error) return { data: null, error };
    out = out.concat(data);
    if (data.length < page) return { data: out, error: null };
    from += page;
  }
}
