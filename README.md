# Commonplace

A shared visual memory for the “where did we put that?” moments.

One person remembers an object. Everyone in the household can find its last-seen evidence, see who contributed it, and report when it moves.

**This repository is a runnable local hackathon starter.** It includes a React app, a FastAPI backend with persistent SQLite memory, a Meta Muse text/voice assistant and Gemini image-analysis adapter, optional private Azure image storage, a read-only connector endpoint, and a separate SpacetimeDB module. Muse Spark via Meta Model API is the user-facing assistant; Gemini remains responsible for computer vision. No consumer Muse connector is needed. Live account and device verification remain setup steps.

## What works now

| Capability                                                                      | Status                                              |
| ------------------------------------------------------------------------------- | --------------------------------------------------- |
| Search objects, filter rooms, inspect a saved scene and bounding box            | Working locally                                     |
| Shared location reports, found events, observation history                      | Working locally                                     |
| Switch between Alex, Pree, and Kyuran in the sample household                   | Working development identities                      |
| Persist memory and sessions across API restarts                                 | SQLite in `.data/`                                  |
| Update a second browser session                                                 | Five-second polling of the same API                 |
| Camera preview and JPEG/PNG/WebP uploads                                        | Camera needs localhost or HTTPS                     |
| Analyze a real image with Gemini                                                | Implemented; requires your API key and model access |
| Store real photographs in private Azure Blob Storage                            | Implemented adapter; requires Azure setup           |
| In-app Muse assistant with fresh household memory and clickable evidence        | Implemented; requires Meta API key and model access |
| Microphone input, browser spoken replies, typed chat                            | Implemented; verify microphone/audio on your device |
| Read-only household search for optional external integrations                   | Existing HTTP endpoint retained                     |
| SpacetimeDB private tables, reducers, invitations, scoped views                 | Separate module; not wired into the local app       |
| Production sign-in, background workers, automatic object reidentification, SLAM | Next milestones                                     |

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
  commonplace_api/muse.py        Muse plain chat and shared-memory tool loop
  commonplace_api/voice.py       Muse Voice Transcribe and audio validation
  commonplace_api/assistant_lab.py Independent backend without database or vision
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
GEMINI_VISION_API_KEY=your-vision-teammates-private-api-key
GEMINI_MODEL=your-accessible-image-capable-model-id
```

Restart the API. Use a model available to your account that supports image input and structured JSON output. The placeholder above must be replaced with an actual model ID; there is no hardcoded model-version assumption.

The capture endpoint normalizes EXIF orientation, removes metadata, resizes the image, requests structured observations, converts Gemini's `[ymin, xmin, ymax, xmax]` values on a 0–1000 scale to normalized `[xmin, ymin, xmax, ymax]`, and validates every box. Invalid responses fail without adding objects.

Analysis currently runs inside the capture request with a bounded provider timeout. There is no background queue yet. Start with one deliberate capture at a time. For the asynchronous design, see [the worker contract](services/worker/README.md).

## Test your Muse assistant independently

Put your Meta Model API key and an enabled model ID in the root `.env`:

```dotenv
MODEL_API_KEY=your-private-meta-api-key
META_MODEL=muse-spark-1.3
META_VOICE_MODEL=muse-voice-transcribe-1.0
```

`muse-spark-1.3` is a documented example; choose a model actually enabled for your Meta project and credit. Never put this key in the frontend. Confirm your $50 offer's eligible products and expiry in the Meta dashboard; the repository cannot verify your balance.

Start these in two terminals:

```bash
make muse-api
```

```bash
make muse-web
```

Open **http://localhost:5173/muse**. This playground uses a separate local backend on **8002**. It does not initialize SQLite, log in a demo household, access photographs, or call Gemini, Azure, or SpacetimeDB. It works regardless of `ASSISTANT_PROVIDER` and ignores incomplete vision/storage setup. The homepage `/` always remains the household app; no launch command redirects it. The **Muse chat** menu link opens the temporary `/muse` test page, which reuses the household assistant layout without making household/database requests. Start `make api` as well to use household features; it initializes the current local SQLite store automatically. Restart an older Vite process to pick up the separate API proxies.

Type a message and press **Send**, or tap **Talk to Muse** once for automatic conversation. Speak and pause: the app detects the end of speech, transcribes and sends it, speaks the answer, and listens again. The microphone is off while processing/playing a reply. **Stop voice session** returns to typing; eight seconds without speech ends listening. **Dictate a message** retains manual review-before-send. Spoken output uses your browser/device voice; blocked playback pauses the voice session and leaves **Read reply** available. Optional **Enable Hello** adds foreground phrase recognition in supported browsers: say “Hello”, wait for “I’m listening”, then ask. It returns to wake standby after one spoken reply. Browser recognition may send listening audio to the browser vendor; it is not an offline wake-word engine. Escape or Disable Hello turns it off, and hiding the page disables it. It cannot listen with the browser closed or interrupt spoken playback. See [accessible voice testing](docs/ACCESSIBILITY.md).

Audio is converted in-browser to mono 24 kHz 16-bit WAV and sent through the backend to **Muse Voice Transcribe**. Clips are capped at 30 seconds and 2 MiB; the microphone stops automatically, and audio is not persisted by our backend. Messages and recordings consume Meta API usage. This is a local development playground with no user sign-in; do not deploy or tunnel it publicly.

Follow [Muse installation and testing](docs/MUSE_TESTING.md) for prerequisites, UI checks, common errors, voice limitations, and the later shared-memory test. No paid requests are sent automatically by the repository's tests.

### Connect Muse to shared household memory later

Set `ASSISTANT_PROVIDER=muse` with the same Meta credentials, then use the normal `make api` + `make web` flow at `/`. The full local app uses its existing SQLite store and demo identities. Muse requests a read-only `search_household_memory` tool; FastAPI authorizes the household, reads fresh records, and returns evidence. Unknown/ambiguous matches get deterministic no-match/clarification responses. Existing member-report, found-event, image, and history features remain in place.

The isolated `/muse` page has no household lookup. It cannot find real household items, and its temporary conversation is not durable shared memory. In the full app, location updates still use the object controls, and earlier chat answers remain snapshots. The Gemini assistant adapter remains available for optional compatibility testing via `ASSISTANT_PROVIDER=gemini`; it is not used in the Muse flow.

## Connect Azure and SpacetimeDB

- **Azure:** follow [account and storage setup](docs/SETUP.md). Install the API's `azure` extra, authenticate with `az login`, create a private container, and configure `STORAGE_PROVIDER=azure`. The adapter uses `DefaultAzureCredential`; no storage key belongs in the browser.
- **SpacetimeDB:** follow [the module instructions](spacetimedb/README.md). It is a separate implementation milestone. Setting `SPACETIMEDB_URL` does not migrate SQLite or enable subscriptions in this frontend.

The existing `GET /api/connector/search?q=adapter` operation and optional `make connector` gateway remain available for external experiments. These external connector experiments are separate from the active Meta Model API integration; no consumer Muse connector registration is required.

The intended cloud architecture is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Follow the [Azure deployment and GoDaddy domain guide](docs/DEPLOYMENT.md) after completing its production-readiness milestones. This local starter does not claim sponsor qualification or production readiness.

## Configuration

Copy `.env.example` to `.env`. Defaults work without credentials.

| Setting                                                | Purpose                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `APP_ENV`                                              | Must be `development` while demo profile selection is enabled             |
| `DATA_DIR`                                             | Local database and image directory; relative to the repository root       |
| `VISION_PROVIDER`                                      | `demo` or `gemini`                                                        |
| `ASSISTANT_PROVIDER`                                   | `disabled` (default), `muse`, or optional `gemini`; independent of vision |
| `MODEL_API_KEY`, `META_MODEL`, `META_VOICE_MODEL`      | Backend-only Muse chat and transcription settings                         |
| `GEMINI_CHAT_API_KEY`                                  | Optional previous Gemini assistant key                                    |
| `GEMINI_VISION_API_KEY`, `GEMINI_MODEL`                | Backend-only photo-analysis credentials/model                             |
| `GEMINI_API_KEY`                                       | Optional legacy shared-key fallback; role-specific keys take precedence   |
| `GEMINI_CHAT_MODEL`                                    | Function-calling model for chat; falls back to `GEMINI_MODEL`             |
| `STORAGE_PROVIDER`                                     | `local` or `azure`; applies to newly saved real images                    |
| `AZURE_STORAGE_ACCOUNT_URL`, `AZURE_STORAGE_CONTAINER` | Private Azure image store                                                 |
| `CORS_ORIGINS`                                         | Explicit comma-separated origins for direct API callers                   |
| `MAX_UPLOAD_BYTES`                                     | Per-image limit, default 8 MiB                                            |

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

Browser tests launch household/Muse APIs on ports 8011/8012 and frontends on 5174/5175 (including a regression check with the obsolete redirect flag) and use a separate directory under `.data/browser-tests/`. They cover search, a report shared between two browser sessions, truthful empty states, mobile overflow, sample capture, and assistant UI/error behavior. Meta/Gemini transports and audio responses are mocked in automated tests; these do not establish actual iPhone microphone/camera behavior, speech quality, or live account connectivity.

## Next implementation milestones

1. Replace demo identities with real sign-in and household membership authorization.
2. Connect the app and vision service to SpacetimeDB; generate client bindings and replace polling with scoped subscriptions. SQLite is a development reference, not a required second cloud database.
3. Extract capture processing into durable jobs with retries, leasing, and idempotent result commits.
4. Add explicit object identity confirmation across captures.
5. Verify Muse chat/voice and Gemini image analysis with their respective project credentials, then deploy the API/frontend to Azure.
6. Rehearse with real household objects on two phones; add a domain after deployment works.

Full SLAM, metric 3D navigation, continuous background video capture, and physical direction arrows are outside this starter's scope.

Licensed under [MIT](LICENSE).
