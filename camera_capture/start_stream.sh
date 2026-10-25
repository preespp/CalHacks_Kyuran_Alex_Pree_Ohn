#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .data
if [[ ! -s .data/access-key ]]; then
  .venv-linux/bin/python -c 'import secrets; from pathlib import Path; Path(".data/access-key").write_text(secrets.token_urlsafe(24))'
fi
test -s .data/db-token || { echo 'Missing .data/db-token (SpacetimeDB owner token)'; exit 1; }
trap 'kill "${receiver:-}" "${watcher:-}" "${tunnel:-}" 2>/dev/null || true' EXIT
.venv-linux/bin/python -m uvicorn receiver:app --host 127.0.0.1 --port 8765 --ws-max-size 1048576 --ws-max-queue 2 > .data/receiver.log 2>&1 &
receiver=$!
.venv-linux/bin/python -u watch_slam.py > .data/watcher.log 2>&1 &
watcher=$!
./cloudflared tunnel --url http://127.0.0.1:8765 --no-autoupdate > .data/tunnel.log 2>&1 &
tunnel=$!
echo "$receiver $watcher $tunnel" > .data/pids
wait
