#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-scriptstore-provider}"
REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-main}"

log() { printf '\033[1;32m[ScriptStore]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[ScriptStore] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || fail "Git belum terpasang. Install Git lalu jalankan ulang."
command -v node >/dev/null 2>&1 || fail "Node.js belum terpasang. Gunakan Node.js 20 atau lebih baru."
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || fail "Node.js minimal versi 20 diperlukan."

if ! command -v pnpm >/dev/null 2>&1; then
  log "pnpm belum ada, mengaktifkan Corepack..."
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@10.4.1 --activate >/dev/null 2>&1 || npm install --global pnpm@10.4.1
fi
command -v pnpm >/dev/null 2>&1 || fail "pnpm gagal disiapkan."

if [ -d "$APP_DIR/.git" ]; then
  log "Folder $APP_DIR sudah ada, mengambil perubahan terbaru..."
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" checkout "$BRANCH" 2>/dev/null || true
  git -C "$APP_DIR" pull --ff-only || fail "Perubahan lokal mencegah pull otomatis."
elif [ -n "$REPO_URL" ]; then
  log "Clone repository dari $REPO_URL..."
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  fail "Set REPO_URL, contoh: REPO_URL=https://github.com/USER/scriptstore-provider.git bash install.sh"
fi

cd "$APP_DIR"
if [ ! -f .env ] && [ -f env.template ]; then
  cp env.template .env
  log "File .env dibuat dari env.template; isi kredensial sebelum menjalankan production."
fi
log "Menginstall dependency..."
pnpm install

if [ "${SKIP_DB:-0}" != "1" ]; then
  if grep -q '^DATABASE_URL=' .env 2>/dev/null && ! grep -q '^DATABASE_URL=$' .env; then
    log "Menjalankan sinkronisasi database..."
    pnpm db:push || log "Database belum dapat disinkronkan; periksa DATABASE_URL di .env."
  else
    log "DATABASE_URL belum diisi; melewati sinkronisasi database."
  fi
fi

log "Memvalidasi TypeScript dan build..."
pnpm check
pnpm build
log "Selesai. Jalankan: cd $APP_DIR && pnpm dev"
log "Saat website pertama dibuka, semua halaman akan mengarah ke setup Buat akun admin pertama."
