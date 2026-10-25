# Setup from scratch

## Prerequisites

Install Git, Node.js 24 and Python 3.12. Check `git --version`, `node --version`, `npm --version` and `python3.12 --version`. Install system tools from their official installers or your usual package manager. If using nvm, the repository's `.nvmrc` selects the Node version.

Commands below use macOS/Linux shell syntax. On Windows, use WSL with Node and Python installed inside WSL; keep its `.venv` separate from Windows environments. Native PowerShell uses `.venv\Scripts\python.exe`, and `make` requires a separate installation. Existing standalone camera/SLAM WSL environments are not prerequisites for the web app.

## Install and run locally

```bash
git clone https://github.com/preespp/CalHacks_Kyuran_Alex_Pree.git
cd CalHacks_Kyuran_Alex_Pree
npm ci
python3.12 -m venv .venv
.venv/bin/python -m pip install -r services/api/requirements-dev.lock
.venv/bin/python -m pip install --no-deps -e services/api
cp .env.example .env
```

For the first setup only, `make setup` is an alternative to the install commands. It does not create `.env`. On subsequent pulls preserve your configured `.env`; update dependencies using the same npm/pip install commands as needed.

Run `make api` and `make web` in separate terminals. Visit <http://localhost:5173>. API documentation is at <http://127.0.0.1:8000/docs>. Use the root project, not your home directory, when running relative commands.

The fresh local configuration needs no provider accounts or database server. It uses local SQLite object memory and temporary selectable names. The browser automatically starts a Pree profile; **Household members** adds or switches names. The household initially has no objects. **New scan → room → Continue** opens camera preview. To use labeled sample objects explicitly, set `SEED_SAMPLE_DATA=true` and restart the API. Samples are not real detections.

## Enable the live workflow

1. Create/access a Meta developer project through the hackathon's current redemption/dashboard instructions. Obtain an API key and an enabled Muse model ID. Set `ASSISTANT_PROVIDER=muse`, `MODEL_API_KEY`, `META_MODEL` and the configured `META_VOICE_MODEL` in `.env`.
2. Create/access a Gemini API project in [Google AI Studio](https://aistudio.google.com/). Choose an image-capable model accessible to that project. Set `VISION_PROVIDER=gemini`, `GEMINI_VISION_API_KEY` and `GEMINI_MODEL`. Do not assume a named free tier or credit amount applies to every model.
3. Obtain the existing team database **server origin** and **database name/identity**. A dashboard URL is not the server origin, and a login identity is not a database ID. The team hosted origin is `https://maincloud.spacetimedb.com`.
4. Set `MEMORY_PROVIDER=spacetimedb`, `CAMERA_FRAME_SINK=spacetimedb`, `CAMERA_SPACETIMEDB_URL` and `CAMERA_SPACETIMEDB_DATABASE`. The module must already expose the upload/readback and object-memory contract in [the pipeline guide](IMAGE_PIPELINE.md).
5. For the same database's existing public `user` table, set `GUEST_PROFILE_STORE=spacetimedb`, `SPACETIMEDB_PROFILE_TABLE=user`, `SPACETIMEDB_PROFILE_ACCESS=public`, `SPACETIMEDB_URL` and `SPACETIMEDB_DATABASE`.
6. Copy matching authorized runtime tokens only if the deployed reducers require them. Table visibility and reducer write permissions are separate. Collaborator access to publish a module is not automatically a runtime uploader credential.
7. Keep `SEED_SAMPLE_DATA=false`, `STORAGE_PROVIDER=local` and `VISION_ENRICHMENT=geometry`, then restart the API. Refresh the browser.

Keep all keys/tokens on the backend. `.env` is gitignored. The actual current model IDs/access/credit balance come from your provider project, not from example strings. See [Meta testing](MUSE_TESTING.md) for a single isolated API request.

## Verify the integration

Select/add a household name, open a scan, choose a room and start shared-memory capture. An uploaded frame is not yet a recognized object: wait for analysis and the memory update. The current UI closes the scan after a successful update. Open a second browser to check shared data, then ask Remi by typing or “Hey Remi”. Browser camera/microphone require permission and localhost or HTTPS; keep the site visible.

For a newly provisioned database, merge/review the actual camera module source before publishing. No ordinary app setup or deployment command should overwrite your teammate's database with a template or reset its data. See [SpacetimeDB modules](../spacetimedb/README.md).

## Update an existing checkout

Pull your team's changes after saving local work. Run `npm ci` when the lockfile changes, reinstall Python dependencies when their lockfile changes, and reinstall the editable API after packaging changes. Restart API/frontend. Run [the checks](TESTING.md) before deploying. Preserve `.env`, `.data` and remote data.

For hosted setup, continue with [Azure App Service + GoDaddy](AZURE_APP_SERVICE.md).
