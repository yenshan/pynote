#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [[ "$(uname -s)" != Darwin ]]; then
  echo "このスクリプトはmacOSで実行してください。" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 22.12以降とnpmが必要です。" >&2
  exit 1
fi
if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)'; then
  echo "Node.js 22.12以降をインストールしてから再実行してください。" >&2
  exit 1
fi

if [[ ! -x node_modules/.bin/electron || ! -x node_modules/.bin/vite || ! -x node_modules/.bin/tsc ]] || ! npm ls --include=dev --depth=0 >/dev/null 2>&1; then
  echo "ビルド用の依存パッケージをインストールしています…"
  npm ci --include=dev
fi

node scripts/prepare-pty.cjs
npm run build
node scripts/package-mac.mjs
