# MotoLog Online 🏍️

Aplikasi web (PWA) untuk mencatat perawatan sepeda motor: ganti oli, servis, bensin, dan pengeluaran lainnya. Versi online ini menyimpan data di **akun Supabase** sehingga bisa dibuka dari HP, tablet, atau laptop lain dengan akun yang sama.

- Frontend: HTML + CSS + JavaScript murni (tanpa build step), mobile-first, bisa diinstal ke layar utama.
- Backend: **Supabase** (Postgres + Auth) dengan **Row Level Security**.
- Hosting: **Cloudflare Pages** (gratis, bandwidth statis tidak dibatasi).
- Setiap akun hanya bisa melihat dan mengubah datanya sendiri.

> Versi offline v1.0.2 tetap tersedia terpisah di [dhiskar.github.io/motolog](https://dhiskar.github.io/motolog/). Repo ini adalah versi online dan tidak mengubah deployment offline tersebut.

---

## Fitur

- **Multi-motor** — kelola beberapa motor, ganti motor aktif dari header.
- **Ganti oli** — riwayat, interval km/bulan, status “sudah waktunya” otomatis.
- **Servis & perbaikan** — bengkel, kategori, biaya, catatan, foto nota.
- **Bensin** — liter, harga/liter, total otomatis, hitung konsumsi km/L.
- **Pengeluaran lain** — pajak, asuransi, parkir, aksesori, dan lain-lain.
- **Dashboard** — ringkasan biaya bulan ini, total km, status oli, aktivitas terakhir.
- **Riwayat** — filter jenis, pencarian, edit & hapus.
- **Statistik** — grafik pengeluaran bulanan, rincian per kategori, efisiensi bahan bakar.
- **Pengingat** — pengingat manual (pajak, servis, dll.) dengan target tanggal/odo.
- **Akun** — daftar/masuk dengan email + password, data tersinkron antar perangkat.
- **Backup** — ekspor/impor JSON dan ekspor CSV manual (tanpa backup otomatis ke file).
- **Impor data lokal** — pindahkan data aplikasi offline di HP yang sama ke akun online.
- **PWA** — bisa diinstal; app shell di-cache agar tampilan cepat dibuka.

Versi online bersifat **online-only**: data utama selalu dibaca dan ditulis ke Supabase. Tanpa internet, aplikasi menampilkan pesan dan tombol muat ulang (tidak ada antrean tulis offline pada v1).

---

## 1. Siapkan Supabase

1. Buat akun di [supabase.com](https://supabase.com) lalu **New project**.
2. Buka **SQL Editor → New query**, tempel seluruh isi [`supabase/schema.sql`](supabase/schema.sql), lalu **Run**.
   - File ini aman dijalankan ulang (idempotent).
   - Isinya: tabel `profiles`, `bikes`, `records`, `reminders`, trigger `updated_at`, trigger profil otomatis, indeks, dan kebijakan RLS.
3. Buka **Project Settings → API**, catat:
   - **Project URL** (contoh `https://abcdefghijklm.supabase.co`)
   - **anon public key**
4. Isi keduanya di [`assets/config.js`](assets/config.js):

```js
window.MOTOLOG_CONFIG = {
  SUPABASE_URL: 'https://abcdefghijklm.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIs...'
};
```

> Kunci `anon` memang aman dipublikasikan. Akses data dibatasi oleh RLS: setiap baris hanya bisa dibaca/ditulis jika `auth.uid() = user_id`.

### Pengaturan Auth yang disarankan (v1)

- **Authentication → Providers → Email**: aktifkan.
- **Authentication → Sign In / Up → Email confirmation**: **matikan** untuk v1.
  - Dengan konfirmasi email menyala, pendaftaran tidak langsung masuk dan pengiriman email bawaan Supabase sangat dibatasi (rate limit).
  - Jika tetap ingin konfirmasi email, gunakan SMTP sendiri di Supabase.
- **Authentication → URL Configuration**: tambahkan URL Cloudflare Pages kamu ke *Site URL* dan *Redirect URLs* setelah deploy.

---

## 2. Jalankan secara lokal

Karena memakai modul dan service worker, buka lewat server HTTP, bukan `file://`:

```powershell
# dari folder proyek
python -m http.server 8099 --bind 127.0.0.1
```

Buka `http://127.0.0.1:8099/`.

Jika `assets/config.js` masih kosong, halaman login tampil dengan pesan konfigurasi dan tombol masuk dinonaktifkan.

---

## 3. Deploy ke Cloudflare Pages

1. Push repo ini ke GitHub/GitLab.
2. Buka [Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git](https://dash.cloudflare.com/).
3. Pilih repo, lalu isi:
   - **Framework preset**: `None`
   - **Build command**: kosongkan
   - **Build output directory**: `/` (root repo)
4. **Save and Deploy**. Situs akan tersedia di `https://<nama>.pages.dev`.
5. Setelah punya domain final, kembali ke Supabase **Authentication → URL Configuration** dan sesuaikan **Site URL**.

Tidak ada proses build. Semua file statis (termasuk `vendor/supabase.js`) dilayani langsung oleh Cloudflare Pages.

### Alternatif: upload langsung

Bisa juga memakai **Direct Upload** di Cloudflare Pages dengan mengunggah isi repo (kecuali `.git`, `dev`, dan file pengembangan lain).

---

## 4. Impor data dari aplikasi offline

Data offline disimpan di `localStorage` dengan kunci `motolog.state.v1` pada perangkat yang sama dan origin yang sama.

1. Buka aplikasi offline lama di HP yang sama, lakukan **Ekspor backup (JSON)** sebagai cadangan.
2. Buka aplikasi online di browser yang sama.
3. Masuk/daftar akun.
4. Buka **Pengaturan → Impor data lokal** (hanya muncul jika data lokal terdeteksi).
5. Konfirmasi. ID lama otomatis diubah menjadi UUID, lalu data dikirim ke akun.
6. Setelah berhasil, data lokal dihapus dari perangkat agar tidak tertukar.

Alternatif lintas perangkat: gunakan **Pengaturan → Impor backup** dengan file JSON hasil ekspor aplikasi offline. Struktur file yang sama juga diterima.

> **Perhatian:** data lokal hanya terbaca jika aplikasi online dibuka dari origin yang sama dengan aplikasi offline. Jika berbeda domain, gunakan file JSON.

---

## 5. Struktur data & keamanan

Tabel di Supabase:

| Tabel | Isi |
| --- | --- |
| `profiles` | Pengaturan per akun: tema, interval oli, motor aktif, status banner instal. |
| `bikes` | Motor milik pengguna. |
| `records` | Catatan oli/servis/BBM/pengeluaran, terhubung ke motor. |
| `reminders` | Pengingat manual, terhubung ke motor. |

- Semua tabel punya kolom `user_id uuid not null default auth.uid()`.
- RLS aktif dengan policy `auth.uid() = user_id` untuk `select`, `insert`, `update`, `delete`.
- Foreign key gabungan `(bike_id, user_id)` memastikan catatan/pengingat tidak bisa menempel ke motor milik akun lain.
- Foto disimpan sebagai data URL JPEG terkompresi (±720 px) di kolom `text` untuk v1. Untuk skala besar, migrasikan ke Supabase Storage.
- Sinkronisasi bersifat diff-based: `ML.persist()` mengantrekan penyimpanan (debounce 700 ms), lalu `assets/cloud.js` mengirim upsert/delete per tabel dan menyimpan snapshot setelah sukses.

### Biaya

- **Supabase Free**: $0 — 500 MB database, 50.000 MAU, 2 project. Project gratis otomatis **di-pause setelah ±7 hari tanpa aktivitas** dan perlu diaktifkan manual dari dashboard.
- **Supabase Pro**: $25/bulan — 8 GB database, backup harian, tidak di-pause.
- **Cloudflare Pages Free**: $0 — 500 build/bulan, bandwidth statis tidak dibatasi, 25 MiB per file.

Untuk pemakaian pribadi/keluarga, kombinasi gratis biasanya cukup. Jika ingin selalu aktif tanpa risiko pause, gunakan Supabase Pro.

---

## 6. Pengembangan

```
index.html                 # shell, markup auth/boot/app, sprite ikon
manifest.webmanifest       # metadata PWA
sw.js                      # service worker (cache app shell)
assets/
  config.js                # URL + anon key Supabase (isi manual)
  core.js                  # state, normalisasi, UUID, perhitungan
  ui.js                    # render dashboard/riwayat/statistik/motor/pengaturan
  sheets.js                # dialog/form, simpan catatan/motor/pengingat, foto
  cloud.js                 # auth Supabase + sinkronisasi data
  app.js                   # boot/auth, event, ekspor/impor, PWA
  style.css                # seluruh tampilan
vendor/supabase.js         # Supabase JS v2 (UMD, di-vendor agar tanpa CDN)
supabase/schema.sql        # skema database + RLS (jalankan sekali)
icons/                     # ikon PWA
```

Urutan script di `index.html` penting: `vendor/supabase.js` → `config.js` → `core.js` → `ui.js` → `sheets.js` → `cloud.js` → `app.js`.

### Menambah perubahan skema

1. Ubah `supabase/schema.sql` (tetap idempotent jika memungkinkan).
2. Jalankan ulang file itu di SQL Editor.
3. Sesuaikan mapping di `assets/cloud.js` (`bikeRow`, `recordRow`, `reminderRow`, `settingsRow`, dan fungsi `*FromRow`).
4. Jika mengubah cache, naikkan `CACHE_VERSION` di `sw.js`.

### Tips rilis

- Selalu uji login, tambah catatan, edit, hapus, dan impor data di akun uji sebelum deploy.
- Ekspor backup JSON berkala tetap disarankan, meskipun data sudah di server.
- Jangan commit kunci `service_role` Supabase. Hanya `anon` key yang boleh ada di frontend.

---

## Lisensi

MIT — lihat [`LICENSE`](LICENSE).
