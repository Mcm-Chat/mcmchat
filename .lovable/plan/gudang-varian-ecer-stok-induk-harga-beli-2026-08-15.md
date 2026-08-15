# Gudang → Varian Ecer (stok induk + harga beli)

## Inti perubahan
Produk berhenti jadi "barang dengan harga jual". Produk = **Gudang**: stok induk + harga beli.
Varian di dalamnya = **cara jual ecer** yang memotong stok gudang dengan konversi akurat.

```text
Gudang "PASIR"  jenis: timbangan (beli per kg)  harga beli Rp x / kg   stok: 1.250 kg
 ├── Varian "Karung 25 kg"   jual Rp …   → potong 25.000 g per unit
 ├── Varian "Ember 5 kg"     jual Rp …   → potong 5.000 g
 └── Varian "Ecer 1 kg"      jual Rp …   → potong 1.000 g

Gudang "AQUA"   jenis: hitungan (beli per dus, isi 24 botol)  stok: 480 botol
 ├── Varian "Dus"    → potong 24 botol
 └── Varian "Botol"  → potong 1 botol
```

## 1. Dialog buat/edit Gudang (menggantikan "Edit produk" di tangkapan layar)
Isian: Nama · Kategori · **Jenis stok** (Timbangan / Hitungan) · **Satuan beli**
(mg/g/ons/kg atau pcs/botol/sachet/dus/karton/sak) · **Isi per satuan beli** (khusus hitungan,
mis. 1 dus = 24 botol) · **Stok awal** · **Harga beli per satuan beli** · Deskripsi.
Field "Harga (Rp)" lama dipakai ulang sebagai **Harga beli**, bukan harga jual —
harga jual hanya ada di varian.

## 2. Stok induk
- Tabel baru `product_stock_balances` (satu baris per produk, `qty_base` dalam gram atau unit dasar).
- `products` dapat kolom: `stock_kind`, `buy_unit`, `units_per_buy`, `purchase_price`.
- Semua penambahan stok (pembelian/restock) masuk ke gudang, bukan ke varian.
- Saldo varian jadi **turunan**: `floor(stok_gudang / ukuran_varian)`; tidak ada lagi stok terpisah per varian yang bisa beda-beda.
- Penjualan/penyiapan/koreksi memotong gudang lewat RPC atomik (`SELECT … FOR UPDATE`, tolak bila stok kurang),
  dengan pencatatan di `inventory_movements` seperti sekarang.
- Migrasi data lama: jumlah saldo varian yang ada sekarang dikonversi ke gram/unit dasar dan dijumlahkan jadi stok gudang awal, jadi tidak ada angka yang hilang.

## 3. Akurasi timbangan
- Timbangan: semua disimpan dalam gram presisi 6 desimal (aturan `src/lib/mcm/decimal.ts` yang sudah ada dipakai apa adanya).
- Hitungan: selalu bilangan bulat unit dasar (pcs/botol); 1 dus = isi × unit dasar.
- Nilai stok gudang = `stok_base × harga beli per base`; margin varian = harga jual − modal per ukuran varian.
  Angka ini yang tampil di indikator katalog (modal, nilai stok, potensi laba).

## 4. Foto, link Maps, dan catatan dari pegawai
- Hasil penyiapan (foto beranotasi, link Maps, catatan) sudah tersimpan sebagai `product_photos`
  + `preparation_job_items`; sekarang ditarik dan ditampilkan **di dalam halaman Gudang**,
  dikelompokkan otomatis di bawah varian yang dipakai saat membuat dialog penyiapan.
- Judul kelompok = judul penyiapan/varian yang diinput ke pegawai, jadi sinkron tanpa input ulang.
- Kalau varian penyiapan belum ada di gudang, kelompok "Perlu ditautkan" muncul dengan satu tombol tautkan.

## 5. Tampilan rapat
- Kartu gudang & varian dirapatkan: padding `p-2.5`, teks `text-xs`/`text-[11px]`, tombol tinggi 32 px,
  angka penting (stok, harga beli, harga jual, laba) sebagai baris ringkas dua kolom, bukan blok besar.
- Dialog pakai kolom rapat + label kecil supaya seluruh isian muat tanpa scroll panjang di layar 360 px.

## Catatan teknis
- Migrasi SQL: kolom baru + tabel saldo gudang + GRANT + RLS mengikuti pola `current_user_can_manage_business`,
  RPC `restock_warehouse`, `consume_warehouse` (dipakai penjualan, penyiapan, koreksi), dan backfill saldo lama.
- Sisi klien: `src/lib/api/catalog.ts` (saldo turunan + tipe gudang), `src/routes/catalog.index.tsx`,
  `src/routes/catalog.$id.tsx`, `src/components/mcm/catalog-parts.tsx`, `purchase-dialog.tsx`, `unit-parts.tsx`.
- Alur pesanan chat, penjualan, dan penyiapan tetap memakai varian; hanya sumber pemotongan stoknya pindah ke gudang.
- Uji: unit test konversi & pemotongan stok (gram + hitungan), plus `vitest run`, `tsgo`, lint sebelum lapor selesai.
