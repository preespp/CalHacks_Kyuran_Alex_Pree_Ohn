# Commonplace

A shared visual memory for the “where did we put that?” moments.

One person remembers an object. Everyone in the household can find its last-seen evidence, see who contributed it, and report when it moves.

**This repository is a runnable local hackathon starter.** It includes a React app, a FastAPI backend with persistent SQLite memory, a real Gemini image-analysis adapter, optional private Azure image storage, a read-only connector endpoint, and a separate SpacetimeDB module. It has not been deployed or connected to a Muse account.

## What works now

| Capability                                                                      | Status                                                |
| ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Search objects, filter rooms, inspect a saved scene and bounding box            | Working locally                                       |
| Shared location reports, found events, observation history                      | Working locally                                       |
| Switch between Alex, Pree, and Kyuran in the sample household                   | Working development identities                        |
| Persist memory and sessions across API restarts                                 | SQLite in `.data/`                                    |
| Update a second browser session                                                 | Five-second polling of the same API                   |
| Camera preview and JPEG/PNG/WebP uploads                                        | Camera needs localhost or HTTPS                       |
| Analyze a real image with Gemini                                                | Implemented; requires your API key and model access   |
| Store real photographs in private Azure Blob Storage                            | Implemented adapter; requires Azure setup             |
| Read-only household search for a Muse connector                                 | Implemented HTTP endpoint; Muse connection unverified |
| SpacetimeDB private tables, reducers, invitations, scoped views                 | Separate module; not wired into the local app         |
| Production sign-in, background workers, automatic object reidentification, SLAM | Next milestones                                       |

Sample illustrations are explicitly labeled. Sample mode never returns canned detections for your uploaded photograph. A person's location report does not turn an older photograph into evidence of the new location.

## Quick start

Use **Node.js 24 LTS**, **Python 3.12**, npm, and Git. No cloud accounts or Docker are required for sample mode. On this Mac, Python 3.12 is available at `/opt/homebrew/bin/python3.12`; the shell's default `python3` points to an older Anaconda installation.

From the repository root:

```bash
# If nvm is installed:
nvm install
nvm use

npm ci
python3.12 -m venv .venv
.venv/bin/python -m pip install -r services/api/requirements-dev.lock
.venv/bin/python -m pip install --no-deps -e services/api
cp .env.example .env
```

Start the API in terminal 1:

```bash
make api
```

Start the frontend in terminal 2:

```bash
make web
```

Open **http://localhost:5173**. Interactive API documentation is at **http://127.0.0.1:8000/docs**.

`make setup` is an alternative to the dependency-install steps above. It uses `python3.12` by default; override it with `make setup PYTHON=/path/to/python3.12` when necessary. The first four sample objects are seeded automatically and persist across restarts.

### Try the shared-memory demo

1. Search for **HDMI adapter** and open its card.
2. Change its room to **Kitchen** and its location to **In the top drawer beside the kettle**.
3. Press **Update location**. The record identifies this as a member report and retains the earlier sample illustration separately.
4. Open a second tab or browser window. Choose **Household → Alex**, then search for the adapter.
5. See the same location and contributor. Open **Recent activity** to see the report.
6. Open **Remember something → Add sample observation** to add another explicitly labeled sample candidate.

Each capture creates candidate objects. The starter deliberately does not merge two similarly named objects across photographs. Multiple matching cards are candidates for the user to choose between, not proof that they are the same physical item.

See [the three-minute demo script](demo/README.md).

## Repository layout

```text
apps/web/                         React + TypeScript + Vite frontend
  src/components/                 Camera, evidence image, accessible dialog
services/api/
  commonplace_api/main.py        HTTP endpoints and session authorization
  commonplace_api/store.py       SQLite reference implementation
  commonplace_api/vision.py      Gemini adapter and image normalization
  commonplace_api/storage.py     Local and private Azure image stores
  tests/                          API, permissions, evidence, provider tests
services/worker/                  Documented next-stage worker contract
spacetimedb/
  src/index.ts                    Private tables, reducers, scoped views
  tests/                          Module permission tests
contracts/                        API and coordinate conventions
demo/                             Original sample illustration and pitch script
docs/                             Setup and architecture decisions
tests/browser/                    Two-session and mobile browser checks
```

The frontend uses plain CSS to keep this first scaffold easy to edit; Tailwind is not required. No image-generation service or stock-photo license is needed for the original sample illustration.

## Enable Gemini

Create a project and API key in [Google AI Studio](https://aistudio.google.com/). In the root `.env`, change:

```dotenv
VISION_PROVIDER=gemini
GEMINI_API_KEY=your-private-api-key
GEMINI_MODEL=your-accessible-image-capable-model-id
```

Restart the API. Use a model available to your account that supports image input and structured JSON output. The placeholder above must be replaced with an actual model ID; there is no hardcoded model-version assumption.

The capture endpoint normalizes EXIF orientation, removes metadata, resizes the image, requests structured observations, converts Gemini's `[ymin, xmin, ymax, xmax]` values on a 0–1000 scale to normalized `[xmin, ymin, xmax, ymax]`, and validates every box. Invalid responses fail without adding objects.

Analysis currently runs inside the capture request with a bounded provider timeout. There is no background queue yet. Start with one deliberate capture at a time. For the asynchronous design, see [the worker contract](services/worker/README.md).

## Connect Azure, SpacetimeDB, and Muse

- **Azure:** follow [account and storage setup](docs/SETUP.md). Install the API's `azure` extra, authenticate with `az login`, create a private container, and configure `STORAGE_PROVIDER=azure`. The adapter uses `DefaultAzureCredential`; no storage key belongs in the browser.
- **SpacetimeDB:** follow [the module instructions](spacetimedb/README.md). It is a separate implementation milestone. Setting `SPACETIMEDB_URL` does not migrate SQLite or enable subscriptions in this frontend.
- **Muse:** `GET /api/connector/search?q=adapter` is a read-only search operation using a scoped bearer session. See [connector setup and limits](docs/SETUP.md#muse-connector). A public HTTPS endpoint and account-specific connector setup are still required.

The intended cloud architecture is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). This local starter does not claim sponsor qualification or production readiness.

## Configuration

Copy `.env.example` to `.env`. Defaults work without credentials.

| Setting                                                | Purpose                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| `APP_ENV`                                              | Must be `development` while demo profile selection is enabled       |
| `DATA_DIR`                                             | Local database and image directory; relative to the repository root |
| `VISION_PROVIDER`                                      | `demo` or `gemini`                                                  |
| `GEMINI_API_KEY`, `GEMINI_MODEL`                       | Backend-only Gemini configuration                                   |
| `STORAGE_PROVIDER`                                     | `local` or `azure`; applies to newly saved real images              |
| `AZURE_STORAGE_ACCOUNT_URL`, `AZURE_STORAGE_CONTAINER` | Private Azure image store                                           |
| `CORS_ORIGINS`                                         | Explicit comma-separated origins for direct API callers             |
| `MAX_UPLOAD_BYTES`                                     | Per-image limit, default 8 MiB                                      |

Use a new `DATA_DIR` for a fresh rehearsal without deleting existing memory. Switching image storage does not migrate previously saved photographs; keep a consistent provider for a dataset.

Sessions expire after 24 hours. The frontend stores the bearer token in browser `sessionStorage`, while the database stores only its hash. The public demo-session endpoint lets anyone choose a sample identity, so this is **not production authentication**. Startup rejects `APP_ENV=production` until that boundary is replaced.

For phone camera testing, expose the frontend through an HTTPS development tunnel that forwards to port 5173; Vite proxies `/api` to the local backend. Forward the tunnel's Host header as `localhost:5173`, or explicitly allow its exact hostname using `DEV_ALLOWED_HOST` when starting Vite. A phone opening a plain HTTP LAN address cannot use this camera flow.

## Verification

```bash
npm run check           # Frontend and SpacetimeDB types, frontend production build
npm run test:module     # Real SpacetimeDB module permission tests using SDK harness
make test               # Backend tests; no live cloud credentials used
```

Optional browser checks:

```bash
npx playwright install chromium
npm run test:browser
```

To use an existing Chrome installation instead of downloading Chromium:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:browser
```

Browser tests launch isolated API/frontend servers on ports 8011/5174 and use a separate directory under `.data/browser-tests/`. They cover search, a report shared between two browser sessions, truthful empty states, mobile overflow, and sample capture. They do not establish actual iPhone camera behavior or live Gemini/Azure/Muse account connectivity.

## Next implementation milestones

1. Replace demo identities with real sign-in and household membership authorization.
2. Connect the app and vision service to SpacetimeDB; generate client bindings and replace polling with scoped subscriptions. SQLite is a development reference, not a required second cloud database.
3. Extract capture processing into durable jobs with retries, leasing, and idempotent result commits.
4. Add explicit object identity confirmation across captures.
5. Complete the authenticated Muse connection and deploy the API/frontend to Azure.
6. Rehearse with real household objects on two phones; add a domain after deployment works.

Full SLAM, metric 3D navigation, continuous background video capture, and physical direction arrows are outside this starter's scope.

Licensed under [MIT](LICENSE).
