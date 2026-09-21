# Install ScriptStore dari Terminal

Installer ini menyiapkan Node.js 20+, pnpm, dependency, konfigurasi lokal, database, TypeScript check, dan production build.

## Penggunaan

```bash
curl -fsSL https://raw.githubusercontent.com/USERNAME/scriptstore-provider/main/install.sh -o install.sh
chmod +x install.sh
REPO_URL=https://github.com/USERNAME/scriptstore-provider.git bash install.sh
cd scriptstore-provider
cp env.template .env
nano .env
pnpm dev
```

Jika ingin melewati migrasi database saat instalasi:

```bash
SKIP_DB=1 REPO_URL=https://github.com/USERNAME/scriptstore-provider.git bash install.sh
```

## Setelah instalasi

Installer hanya memasang kode, dependency, dan migrasi database. Installer **tidak membuat akun admin**. Setelah website dijalankan dan dibuka, semua halaman otomatis menampilkan layar **Buat akun admin pertama**. Masuk dengan akun Anda, pilih **Buat akun admin**, lalu gerbang setup otomatis mati dan website dapat digunakan normal.

Contoh menjalankan setelah instalasi:

```bash
cd scriptstore-provider
cp env.template .env
nano .env
pnpm dev
```

Untuk production:

```bash
pnpm build
NODE_ENV=production pnpm start
```

Repositori privat memerlukan kredensial GitHub pada hosting atau clone repository terlebih dahulu, kemudian jalankan installer dari folder tersebut.

## Konfigurasi minimum

Isi `DATABASE_URL`, `JWT_SECRET`, variabel Manus OAuth, dan kredensial built-in storage. **Jangan commit file `.env` ke GitHub.**

## Fitur yang disiapkan

Dashboard memiliki role **admin**, **penjual**, dan **pembeli**. Pembeli memiliki beranda, saldo, produk saya, transaksi digital, foto profil, Gmail, nomor HP, reset password placeholder, dan copy script setelah pembelian. Penjual dapat memilih script utuh atau produk API dengan script rahasia. Admin dapat mengatur biaya marketplace, moderasi produk, role user, dan suspend user.

## Template script otomatis

Penjual dapat menempelkan token berikut ke script publik: `{{storeName}}`, `{{primaryColor}}`, `{{secondaryColor}}`, `{{logoUrl}}`, `{{heroImage}}`, `{{apiBaseUrl}}`, `{{apiPath}}`, dan `{{openOlshopUrl}}`. Sistem mendeteksinya otomatis. Setelah membeli, pembeli mendapatkan editor untuk mengganti nama toko, warna, logo, gambar hero, jalur API, dan alamat koneksi Open Olshop. Sistem menyimpan konfigurasi per pembeli lalu menghasilkan script baru dengan token yang sudah diganti.

URL gambar mentah yang diberi penanda `id`, `class`, `alt`, atau `data-scriptstore` dengan kata `banner`, `hero`, `logo`, atau `cover` otomatis diubah menjadi field tampilan. Contoh: `<img id="banner-utama" src="https://contoh.com/banner.jpg">` dapat diganti pembeli dari dashboard. Script hasil pembeli dilindungi dengan minify dan obfuscation JavaScript; admin dapat mengaktifkan atau menonaktifkannya dari **Pengaturan admin**.

Produk dapat dijual sebagai **sekali beli** atau **langganan**. Langganan default aktif selama **30 hari**. Setelah lewat masa aktif, akses script/template otomatis ditolak sampai pembeli melakukan pembelian/perpanjangan yang baru. Admin dapat membaca, mengubah status, mengaktifkan, menonaktifkan, atau menghapus produk dan akun.
