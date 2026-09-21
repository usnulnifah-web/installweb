# ScriptStore Provider

Marketplace script dengan dashboard **admin, penjual, dan pembeli**, editor tampilan otomatis, proteksi JavaScript hasil, dan pengaturan domain asset gambar khusus admin.

Repositori ini privat: `https://github.com/usnulnifah-web/installweb`

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
VITE_APP_ID=isi-app-id-manus
VITE_OAUTH_PORTAL_URL=https://oauth.manus.im
OAUTH_SERVER_URL=https://api.manus.im
BUILT_IN_FORGE_API_URL=isi-url-forge
BUILT_IN_FORGE_API_KEY=isi-api-key-forge
```

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

## Setup admin pertama

Installer **tidak membuat akun admin**. Setelah website dibuka, jika database belum memiliki admin, seluruh halaman akan menampilkan **Buat akun admin pertama**. Login menggunakan akun Manus, klik **Buat akun admin**, lalu gerbang setup otomatis mati.

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
