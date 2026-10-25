#!/usr/bin/env bash
# Run as the deployer on the Ubuntu server, after git fetch. Never activates a release.
set -euo pipefail
umask 022
if [[ $# != 1 || $EUID == 0 ]]; then
  echo "Usage: bash deploy/vultr/build-release.sh COMMIT (as the non-root deployer)" >&2
  exit 2
fi
cp_root=/srv/commonplace
cp_repo="$cp_root/repo"
cp_sha=$(git -C "$cp_repo" rev-parse --verify --end-of-options "$1^{commit}")
cp_release=$(mktemp -d "$cp_root/releases/$(date -u +%Y%m%dT%H%M%SZ)-${cp_sha:0:12}-XXXXXX")
chmod 755 "$cp_release"
git -C "$cp_repo" archive "$cp_sha" | tar -x -C "$cp_release"
cd "$cp_release"
npm ci
npm run check
python3.12 -m venv .venv
.venv/bin/python -m pip install -r services/api/requirements-dev.lock
.venv/bin/python -m pip install --no-deps -e services/api
# Isolated local smoke test: no cloud keys, remote users, images or model calls.
APP_ENV=prototype MEMORY_PROVIDER=sqlite SEED_SAMPLE_DATA=false ASSISTANT_PROVIDER=disabled VISION_PROVIDER=demo GUEST_PROFILE_STORE=local CAMERA_FRAME_SINK=disabled STORAGE_PROVIDER=local \
  .venv/bin/python - <<'PY'
import os
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient
from commonplace_api.config import Settings
with tempfile.TemporaryDirectory() as directory:
    os.environ['DATA_DIR'] = directory
    from commonplace_api.main import create_app
    with TestClient(create_app(Settings(data_dir=Path(directory), app_env='prototype', guest_profile_store='local'))) as client:
        assert client.get('/api/health').status_code == 200
        response = client.post('/api/guest/session', json={'name': 'Release check'})
        assert response.status_code == 200
        assert client.get('/api/objects', headers={'Authorization': 'Bearer ' + response.json()['token']}).status_code == 200
PY
mkdir -p "$cp_root/assets"
cp -a apps/web/dist/assets/. "$cp_root/assets/"
printf '\nBuilt release; not activated: %s\n' "$cp_release"
