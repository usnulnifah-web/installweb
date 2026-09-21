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

## Konfigurasi minimum

Isi `DATABASE_URL`, `JWT_SECRET`, variabel Manus OAuth, dan kredensial built-in storage. **Jangan commit file `.env` ke GitHub.**

## Fitur yang disiapkan

Dashboard memiliki role **admin**, **penjual**, dan **pembeli**. Pembeli memiliki beranda, saldo, produk saya, transaksi digital, foto profil, Gmail, nomor HP, reset password placeholder, dan copy script setelah pembelian. Penjual dapat memilih script utuh atau produk API dengan script rahasia. Admin dapat mengatur biaya marketplace, moderasi produk, role user, dan suspend user.

## Template script otomatis

Penjual dapat menempelkan token berikut ke script publik: `{{storeName}}`, `{{primaryColor}}`, `{{secondaryColor}}`, `{{logoUrl}}`, `{{heroImage}}`, `{{apiBaseUrl}}`, `{{apiPath}}`, dan `{{openOlshopUrl}}`. Sistem mendeteksinya otomatis. Setelah membeli, pembeli mendapatkan editor untuk mengganti nama toko, warna, logo, gambar hero, jalur API, dan alamat koneksi Open Olshop. Sistem menyimpan konfigurasi per pembeli lalu menghasilkan script baru dengan token yang sudah diganti.

Produk dapat dijual sebagai **sekali beli** atau **langganan**. Langganan default aktif selama **30 hari**. Setelah lewat masa aktif, akses script/template otomatis ditolak sampai pembeli melakukan pembelian/perpanjangan yang baru. Admin dapat membaca, mengubah status, mengaktifkan, menonaktifkan, atau menghapus produk dan akun.
