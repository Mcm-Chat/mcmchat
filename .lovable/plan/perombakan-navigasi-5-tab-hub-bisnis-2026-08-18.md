# Perombakan Navigasi: 5 Tab + Hub Bisnis

## Hasil akhir
Bottom-nav jadi 5 tab (Chat, Panggilan, Catatan, Bisnis, Profil). `/business` berhenti jadi redirect dan menjadi hub berisi tiga segmen: Katalog, Tugas, Kelola Bisnis. "Buat Bisnis" naik jadi aksi utama di hub, tidak lagi tersembunyi di empty-state Katalog.

## 1. Bottom navigation
`src/components/mcm/app-shell.tsx`
- `NAV` dari 6 item jadi 5:
  - Chat `/chat`, Panggilan `/calls`, Catatan `/finance` (label diganti dari "Keuangan"), Bisnis `/business` (ikon `Store`), Profil `/profile`.
  - Item `/tasks` dan `/catalog` dihapus dari bar.
- `grid-cols-6` → `grid-cols-5` (target sentuh jadi ~72px, tetap ≥44px di 360px).
- Badge: kunci badge `/finance` tetap; tambah badge `/business` = jumlah tugas penyiapan aktif untuk saya (sumber sama dengan yang dipakai halaman Tugas) supaya notifikasi tugas tidak hilang bersama tabnya.
- Highlight aktif: `/business` juga aktif saat berada di `/catalog/$id` dan `/tasks/$id` (halaman detail), lewat daftar `matchExtra`.

## 2. Struktur rute
Baru:
- `src/routes/business.tsx` — layout hub: `AppShell` + header + segmented tabs + `<Outlet />`.
- `src/routes/business.index.tsx` — **ditulis ulang** (bukan redirect lagi) = segmen **Katalog** di `/business`.
- `src/routes/business.tugas.tsx` — segmen **Tugas** di `/business/tugas`.
- `src/routes/business.kelola.tsx` — segmen **Kelola Bisnis** di `/business/kelola`.

Tetap apa adanya (deep link dari push/chat tidak boleh putus):
- `src/routes/catalog.$id.tsx` (detail produk), `src/routes/tasks.$id.tsx` (detail tugas), `src/routes/ledger.$id.tsx`, `src/routes/finance.index.tsx`.

Jadi redirect permanen ke hub (satu lompatan, bukan double-redirect):
- `src/routes/catalog.index.tsx` → `redirect({ to: "/business" })` di `beforeLoad`.
- `src/routes/tasks.index.tsx` → `redirect({ to: "/business/tugas" })` di `beforeLoad`.
Redirect dilakukan di `beforeLoad`, bukan `useEffect`, supaya tidak ada layar "Membuka katalog…" yang berkedip.

## 3. Pemindahan konten
Isi halaman dipindah ke komponen panel agar file rute tetap tipis:
- `src/components/mcm/business/catalog-panel.tsx` ← badan `catalog.index.tsx` (produk, varian, gudang, folder kategori, insight, pembelian). Header `MobileHeader` dilepas — header disediakan layout hub.
- `src/components/mcm/business/tasks-panel.tsx` ← badan `tasks.index.tsx` (tab status, filter pegawai, dialog buat penyiapan).
- `src/components/mcm/business/manage-panel.tsx` ← kartu "Bisnis" yang sekarang ada di `src/routes/profile.index.tsx` (data bisnis, profil publik, daftar tim + ubah peran).
  Di `profile.index.tsx` kartu itu diganti satu baris ringkas: nama bisnis + peran + tombol "Kelola" → `/business/kelola`. Tidak ada logika bisnis yang dihapus, hanya dipindah.

## 4. Buat Bisnis
- `src/components/mcm/business/create-business-dialog.tsx` — dialog `createBusiness` diangkat dari empty-state katalog jadi komponen sendiri.
- Di hub, saat `myBusiness` kosong: satu empty-state hub (bukan per segmen) dengan tombol utama **Buat Bisnis**; segmen tab disembunyikan sampai bisnis ada.
- Saat sudah punya bisnis, aksi "Buat Bisnis" tetap tersedia di menu `⋮` header hub (untuk bisnis kedua), memakai dialog yang sama.

## 5. Rujukan yang ikut diperbarui
- `src/lib/push/deeplink.ts` (`routeFromPush`): target tugas → `/business/tugas`, katalog → `/business`; deep link detail `/tasks/$id` & `/catalog/$id` tidak berubah.
- Semua `<Link to="/catalog">` / `to="/tasks"` di `catalog-parts.tsx`, `task-parts.tsx`, `sale-dialog.tsx`, `product-insight-dialog.tsx`, `purchase-dialog.tsx`, `warehouse-intake-log.tsx`, `unit-parts.tsx`, `prepare.ts` diarahkan ke rute hub baru.
- Metadata: tiap rute hub punya `head()` sendiri (Katalog / Tugas / Kelola Bisnis) dengan judul & deskripsi berbeda.

## 6. Verifikasi
- Guard baru di `src/lib/security/__tests__` : bottom-nav wajib tepat 5 tab dengan urutan Chat→Panggilan→Catatan→Bisnis→Profil, dan `/business` dilarang mengandung redirect otomatis.
- Perbarui E2E navigasi mobile jadi 5 tab + tiga segmen hub; jalankan uji tema/warna yang sudah ada.
- Screenshot 360px light & dark untuk `/business`, `/business/tugas`, `/business/kelola`, cek tidak ada overflow dan console bersih.

## Yang TIDAK diubah
Skema database, RLS, alur chat/panggilan/ledger, dan paket/keystore aplikasi.
