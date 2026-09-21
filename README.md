# ScriptStore Provider

Marketplace script dengan dashboard **admin, penjual, dan pembeli**, editor tampilan otomatis, proteksi JavaScript hasil, dan pengaturan domain asset gambar khusus admin.

Repositori ini privat: `https://github.com/usnulnifah-web/installweb`

## Persyaratan hosting

Aplikasi ini adalah aplikasi full-stack Node.js, bukan website HTML statis. Hosting yang dipilih harus mendukung **Node.js 20 atau lebih baru**, Terminal/SSH untuk menjalankan installer dan migrasi, serta proses Node.js yang dapat berjalan terus sebagai aplikasi production. Hosting juga memerlukan database **MySQL/MariaDB** yang dapat diakses melalui `DATABASE_URL`.

Untuk login Google, gunakan domain dengan **HTTPS** dan tambahkan redirect URI `https://domain-anda.com/api/auth/google/callback` di Google Cloud Console. Isi `APP_BASE_URL`, `GOOGLE_CLIENT_ID`, dan `GOOGLE_CLIENT_SECRET` di `.env`. Untuk fitur lupa password melalui email, hosting harus mengizinkan koneksi SMTP keluar dan konfigurasi `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, serta `SMTP_FROM`.

Pastikan hosting menyediakan penyimpanan yang dapat ditulis untuk kebutuhan upload/storage aplikasi, resource yang cukup untuk proses build, dan kemampuan menjalankan perintah `pnpm install`, `pnpm check`, `pnpm db:push`, `pnpm build`, serta `pnpm start`. Hosting yang hanya menyediakan FTP tanpa Terminal/SSH, Node.js, database, atau proses aplikasi persisten tidak cukup untuk menjalankan aplikasi ini secara lengkap. FTP hanya dapat dipakai untuk mengunggah file; instalasi dan migrasi tetap harus dijalankan melalui Terminal/SSH.

Sebelum membeli hosting, tanyakan apakah tersedia **Node.js app manager** atau PM2/systemd, akses environment variables, database MySQL/MariaDB, SSL/HTTPS, dan konfigurasi domain/subdomain ke port aplikasi. Shared hosting PHP-only dan GitHub Pages tidak cocok untuk aplikasi ini.

## Autoinstall di hosting

Karena repositori privat, hosting harus sudah memiliki akses GitHub melalui SSH key atau credential GitHub.

### Cara yang disarankan: SSH

```bash
git clone --branch main git@github.com:usnulnifah-web/installweb.git scriptstore-provider
cd scriptstore-provider
APP_DIR=. REPO_URL=git@github.com:usnulnifah-web/installweb.git bash install.sh
```

Installer akan memeriksa Node.js 20+, menyiapkan pnpm, memasang dependency, membuat `.env`, menjalankan sinkronisasi database jika `DATABASE_URL` sudah diisi, melakukan TypeScript check, dan membuat production build.

### Jika memakai HTTPS

Gunakan credential/token GitHub pada hosting, lalu jalankan:

```bash
REPO_URL=https://github.com/usnulnifah-web/installweb.git bash install.sh
```

Jangan menaruh token GitHub secara permanen di URL, history shell, file project, atau `.env`.

### Konfigurasi setelah install

```bash
cd scriptstore-provider
cp env.template .env
nano .env
```

Isi minimal:

```env
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DATABASE
JWT_SECRET=ganti-dengan-secret-acak-yang-panjang
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=alamat-gmail-atau-workspace
SMTP_PASSWORD=app-password-google
SMTP_FROM=alamat-gmail-atau-workspace
APP_BASE_URL=https://domain-anda.com
GOOGLE_CLIENT_ID=client-id-dari-google-cloud
GOOGLE_CLIENT_SECRET=secret-dari-google-cloud
```

Di Google Cloud Console, aktifkan Google Identity, buat OAuth Client ID tipe Web application, lalu tambahkan redirect URI `https://domain-anda.com/api/auth/google/callback`. Jangan commit `GOOGLE_CLIENT_SECRET` atau file `.env`.

Jalankan migrasi dan aplikasi:

```bash
pnpm db:push
pnpm build
NODE_ENV=production pnpm start
```

Untuk development:

```bash
pnpm dev
```

## Login lokal dan lupa password

Aplikasi menggunakan username dan password lokal. Pendaftaran meminta username, email, password minimal 15 karakter, serta pertanyaan dan jawaban keamanan. Jawaban keamanan di-hash dan tidak disimpan dalam teks biasa.

Lupa password menggunakan token acak satu kali yang berlaku 20 menit dan dikirim melalui SMTP. Pesan API dibuat seragam agar tidak membocorkan apakah sebuah akun terdaftar. Untuk Gmail, aktifkan 2-Step Verification lalu buat Google App Password. Jangan commit `SMTP_PASSWORD` atau file `.env` ke repositori.

Jalankan migrasi setelah memperbarui kode:

```bash
pnpm db:push
```

Login dapat dilakukan dengan username/password lokal atau Google OAuth. Google OAuth memerlukan `APP_BASE_URL`, `GOOGLE_CLIENT_ID`, dan `GOOGLE_CLIENT_SECRET`.

## Setup admin pertama

Installer **tidak membuat akun admin**. Setelah website dibuka, jika database belum memiliki admin, seluruh halaman akan menampilkan **Buat akun admin pertama**. Login menggunakan akun lokal atau Google, klik **Buat akun admin**, lalu gerbang setup otomatis mati.

Admin dapat menyalakan atau mematikan login Google dari **Dashboard → Pengaturan toko → Login dengan Google**. Saat dimatikan, tombol Google disembunyikan dan callback OAuth ditolak. Saklar aktif secara default setelah migrasi.

## Google Ads dan SEO

Google Ads/AdSense dapat diatur admin dari **Dashboard → Pengaturan toko → Google Ads**. Isi Publisher ID dengan format `ca-pub-...`, Ad Slot, dan posisi iklan, lalu centang **Aktif** dan simpan. Script AdSense hanya dimuat ketika iklan aktif dan Publisher ID serta Ad Slot terisi; jika salah satu kosong, unit iklan tidak dirender. Setelah akun AdSense disetujui, pertimbangkan menambahkan `ads.txt` sesuai instruksi Google pada domain utama.

SEO dasar tersedia melalui menu **SEO toko**, yang mengatur judul dan deskripsi halaman. Aplikasi juga membuat metadata description, Open Graph, canonical URL, dan JSON-LD WebSite pada halaman publik. Gunakan judul yang spesifik, deskripsi ringkas, domain HTTPS, serta pastikan halaman publik dapat diakses tanpa login. Dashboard dan halaman login tidak ditujukan untuk pengindeksan mesin pencari.

## Fitur keamanan

Script hasil pembeli dapat di-minify dan di-obfuscate. Pengaturan ini hanya dapat diubah admin dari **Dashboard → Pengaturan admin**. Upload gambar dibatasi ke JPG, PNG, dan WebP. API key tidak dikirim ke script pembeli.

## Domain asset gambar

Hanya admin yang dapat mengatur **Domain asset gambar**. Masukkan domain HTTPS, misalnya:

```text
https://cdn.tokoku.com
```

Sistem hanya mengubah asset internal seperti `/manus-storage/...` ke domain tersebut. URL gambar eksternal tidak diproxy.

## Cara kerja template

Penjual cukup menempelkan script mentah. URL gambar yang diberi penanda `banner`, `hero`, `logo`, atau `cover` akan menjadi field tampilan otomatis. Contoh:

```html
<img id="banner-utama" src="https://contoh.com/banner.jpg">
```

Pembeli dapat mengganti banner atau logo dari dashboard tanpa mengubah logika toko. Produk baru berstatus `pending` dan baru tampil publik setelah diterbitkan admin.

## Validasi lokal

```bash
pnpm test
pnpm check
pnpm build
```

Installer resmi berada di [`install.sh`](./install.sh), dan panduan tambahan tersedia di [`INSTALL.md`](./INSTALL.md).
