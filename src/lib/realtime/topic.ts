/**
 * Nama kanal realtime yang unik per pelanggan.
 *
 * supabase-js menyimpan kanal berdasarkan nama topik. Bila dua bagian aplikasi
 * berlangganan topik yang sama (mis. banner panggilan masuk dan halaman
 * panggilan sama-sama memantau `call:<id>`), pelanggan kedua mendapat objek
 * kanal yang SUDAH `subscribe()`, lalu pemanggilan `.on("postgres_changes")`
 * melempar error dan menjatuhkan layar ke halaman error. Menambahkan akhiran
 * unik membuat setiap pelanggan punya kanal sendiri, sehingga `removeChannel`
 * satu pelanggan juga tidak memutus pelanggan lain.
 */
let seq = 0;

export function uniqueTopic(base: string): string {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${base}#${seq}${rand}`;
}
