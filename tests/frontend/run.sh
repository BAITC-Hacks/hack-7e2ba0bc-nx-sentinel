#!/usr/bin/env bash
set -u
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND="${1:-/home/fofka/Рабочий стол/XAKATON/HACKTON/frontend}"
shift 2>/dev/null || true
exec python3 "$HERE/run_frontend_tests.py" "$FRONTEND" "$@"
