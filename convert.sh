#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ $# -lt 1 ]]; then
  echo "Usage: bash convert.sh <path/to/design.html> [options]"
  echo
  echo "Examples:"
  echo "  bash convert.sh design.html"
  echo "  bash convert.sh design.html --duration 10 --fps 60"
  echo "  bash convert.sh design.html --out out.mp4 --width 1280 --height 720"
  echo
  echo "Full help: node convert.js --help"
  exit 1
fi

node "$SCRIPT_DIR/convert.js" "$@"
