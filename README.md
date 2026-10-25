# Remi

Remi is a shared household memory for finding everyday objects. Scan a room, keep the last-seen image and location, then search or ask Remi by typing or voice. Household members share the same object memory; the app does not identify who placed an item.

The interface is named **Remi**. **Meta Muse** powers chat and transcription, **Gemini** analyzes selected images, and **SpacetimeDB** stores live users, images, objects and observation history. Python package names, npm workspace names and environment variables retain their existing `commonplace`/`muse` identifiers.

## Start from a fresh clone

Install **Git**, **Node.js 24** (see `.nvmrc`), and **Python 3.12**. Docker and cloud accounts are not required for the local preview.

```bash
git clone https://github.com/preespp/CalHacks_Kyuran_Alex_Pree.git
cd CalHacks_Kyuran_Alex_Pree
npm ci
python3.12 -m venv .venv
.venv/bin/python -m pip install -r services/api/requirements-dev.lock
.venv/bin/python -m pip install --no-deps -e services/api
cp .env.example .env
```

Copy `.env.example` only on the first setup; preserve your `.env` when updating. If you use nvm, run `nvm install` and `nvm use` before `npm ci`. The commands above use a macOS/Linux shell; see [setup](docs/SETUP.md) for Windows/WSL and prerequisites.

Start two terminals in the repository root:

```bash
# Terminal 1
make api
```

```bash
# Terminal 2
make web
```

Open **http://localhost:5173**. The current prototype automatically opens a Pree guest profile when no browser session exists. Use **Household members**, directly below **How it works**, to add a name or select a saved profile. These are name-only display profiles, not verified accounts.

The default configuration shows an empty household with camera preview available and AI disabled. Choose **New scan**, select a room, then **Continue with …** to open capture controls. Samples are off by default. For an explicitly labeled local sample, set `SEED_SAMPLE_DATA=true` and restart the API.

## Enable the live application

Follow [provider and database setup](docs/SETUP.md#enable-the-live-workflow). Keep credentials in the root `.env` locally and Azure application settings when hosted. Never put provider keys in `VITE_*` variables.

| Part                               | Required configuration                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Remi chat and speech transcription | `ASSISTANT_PROVIDER=muse`, `MODEL_API_KEY`, `META_MODEL`, `META_VOICE_MODEL`                                                   |
| Computer vision                    | `VISION_PROVIDER=gemini`, `GEMINI_VISION_API_KEY`, `GEMINI_MODEL`                                                              |
| Live images and object memory      | `MEMORY_PROVIDER=spacetimedb`, `CAMERA_FRAME_SINK=spacetimedb`, matching `CAMERA_SPACETIMEDB_URL` and database ID              |
| Shared saved names                 | `GUEST_PROFILE_STORE=spacetimedb`, `SPACETIMEDB_PROFILE_TABLE=user`, public access, matching `SPACETIMEDB_URL` and database ID |

The shared database must already expose the camera/memory module in `camera_capture/stream_module`. Connecting the app does not create missing tables. Coordinate schema changes with the database owner; ordinary website deployment does not publish or reset the database. See [image pipeline](docs/IMAGE_PIPELINE.md) and [configuration](docs/CONFIGURATION.md).

## Current interface and behavior

- **Overview**: search, latest-room illustration, remembered objects and the main **Ask Remi** card. Click its heading to expand the conversation.
- **My objects**: category illustrations for eight room types, custom-room fallback, object selection and saved evidence. The scenes and pin placement are illustrations, not reconstructed floor plans or navigation coordinates.
- **Activity**: saved observation timeline.
- **Household members**: add a name or switch to a saved user. Duplicate names can have different IDs.
- **New scan**: a scrollable room/camera dialog. Captures immediately, then every **5 seconds** by default, with **3/4/5-second** choices and one upload at a time. The current UI closes the dialog after a completed memory update; closing it unmounts/stops the camera. There is no separate Camera menu or continuous camera across app screens.
- **Voice**: “Hey Remi”, “Hello Remi” or “Hi Remi” activates the persistent assistant. Wait for the greeting, ask and pause. Voice, volume and speed settings are above sidebar memory storage. Typing remains available; wake listening has no on/off switch. The page must remain visible and device permissions still apply.

The UI date updates at local midnight. Remi answers from fresh saved records; old chat turns remain snapshots. Object association is conservative and can produce separate candidates when appearance changes. Objects not seen again are not automatically proven absent. Some older object-card depth/match badges remain generated presentation values; they are not calibrated measurements. See [architecture and limits](docs/ARCHITECTURE.md).

## Tests

```bash
npm run check
make test
npm run test:module
npx playwright install chromium
npm run test:browser
```

Automated checks use local fixtures and mocked provider/remote-database responses. They do not verify live credits, deployed permissions or real iPhone microphone behavior. See [testing and troubleshooting](docs/TESTING.md) for focused runs, browser installation and live acceptance checks.

## Deploy on Azure and use GoDaddy

```bash
.venv/bin/python deploy/azure/package.py
```

This checks/builds React and writes `remi-azure.zip`; it does not deploy. Follow [Azure + GoDaddy](docs/AZURE_APP_SERVICE.md) to configure your Linux Python App Service, backend keys, startup command, DNS and HTTPS.

Azure uses **one instance/worker**, `APP_ENV=prototype` and temporary SQLite sessions under `/tmp/remi`. Shared names, images and object memory remain in SpacetimeDB. Persistent App Service network storage is unsuitable for this SQLite session database. A fresh session may be needed after server replacement. [Deployment options](docs/DEPLOYMENT.md) also documents the optional Vultr host.

## Repository

```text
apps/web/                  React, TypeScript, Vite, CSS and SVG room illustrations
services/api/              FastAPI, sessions, providers and API/worker unit tests
services/worker/           Image processing, relations and optional local ML stages
camera_capture/            Shared image-quality/wire helpers and standalone experiments
  stream_module/           Team public user/image/object-memory database module
spacetimedb/               Alternative private-household and guest-registry modules/tests
contracts/                 API and coordinate contract
tests/browser/             Current UI feature tests; shared mocks in support/
scripts/                   Opt-in provider checks and experimental runners
deploy/                    Azure packaging and optional Vultr configuration
demo/                      Demo script and clearly labeled sample illustration
docs/                      Setup, configuration, workflow, testing and hosting
```

Start with [the documentation index](docs/README.md). This is a shared hackathon prototype: display names are unverified, the team database is public, and the app is not a private-household authentication system or a walking-navigation aid.
