#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo
echo "============================================================"
echo "  html-to-mp4  --  one-time setup"
echo "============================================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js not found on PATH. Install from https://nodejs.org"
  exit 1
fi
echo "[OK] Node.js $(node --version)"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "WARNING: ffmpeg not found on PATH."
  echo "         On macOS, install with: brew install ffmpeg"
else
  FF_LINE="$(ffmpeg -version 2>/dev/null | head -n 1 || true)"
  if [[ -n "$FF_LINE" ]]; then
    echo "[OK] $FF_LINE"
  else
    echo "[OK] ffmpeg found"
  fi
fi

echo
echo "[1/2] Installing npm dependencies..."
npm install

echo
echo "[2/2] Installing Playwright Chromium (~120 MB, one-time)..."
npx playwright install chromium

echo
echo "============================================================"
echo "  Setup complete."
echo
echo "  Usage:  bash convert.sh path/to/design.html [options]"
echo "  Help:   node convert.js --help"
echo "============================================================"
echo
