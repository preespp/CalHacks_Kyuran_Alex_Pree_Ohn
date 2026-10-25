# Commonplace

A shared visual memory for the “where did we put that?” moments.

A live room scan updates object locations automatically. Everyone in the household can search the same last-seen image, bounding box, room, location description, and time. Memory does not record who placed an item.

**This repository is a runnable local hackathon starter.** It includes a React app, a FastAPI backend, Onyu’s connected Gemini vision pipeline, shared SpacetimeDB object memory and evidence, a Meta Muse text/voice assistant, and SQLite app sessions. A local SQLite memory mode remains available for development. Muse Spark via Meta Model API is the user-facing assistant; Gemini remains responsible for computer vision. No consumer Muse connector is needed. Live account and device verification remain setup steps.

## What works now

| Capability                                                                     | Status                                                           |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Search objects, filter rooms, inspect a saved scene and bounding box           | Working locally                                                  |
| Shared last-seen locations and observation history                             | Working locally; no contributor attribution                      |
| Join with any display name, switch guests, leave the session                   | Working; no email, password, or account subscription             |
| Persist object memory and app sessions                                         | SpacetimeDB live memory; SQLite session hashes in DATA_DIR       |
| Update a second browser session                                                | Five-second polling of the same API                              |
| Persistent camera capturing every 3–5 seconds                                  | Camera preview works without Gemini; memory analysis uses Gemini |
| Camera preview, front/back selection, JPEG quality, top-three frame ranking    | Working without Gemini; authenticated backend checks             |
| Analyze a real image with Gemini                                               | Implemented; requires your API key and model access              |
| Store real photographs on the host disk                                        | Working; keep DATA_DIR outside release folders and back it up    |
| In-app Muse assistant with fresh household memory and clickable evidence       | Implemented; requires Meta API key and model access              |
| Microphone input, browser spoken replies, typed chat                           | Implemented; verify microphone/audio on your device              |
| Read-only household search for optional external integrations                  | Existing HTTP endpoint retained                                  |
| Shared SpacetimeDB objects, image evidence and observation history             | Connected to the team camera module and Muse                     |
| Production sign-in, background workers, reliable object reidentification, SLAM | Next milestones                                                  |

Samples are off by default. Empty households show no fabricated objects. Existing sample records are hidden without deletion; isolated fixtures can explicitly enable SEED_SAMPLE_DATA=true. A person's location report does not turn an older photograph into evidence of the new location.

## Quick start

Use **Node.js 24 LTS**, **Python 3.12**, npm, and Git. No cloud accounts or Docker are required to open the empty local app and test camera preview. On this Mac, Python 3.12 is available at `/opt/homebrew/bin/python3.12`; the shell's default `python3` points to an older Anaconda installation.

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

Open **http://localhost:5173**, enter your name, and select **Continue as guest**. No password, email, paid user subscription, or external identity provider is needed. Guests share one prototype household. Interactive API documentation is at **http://127.0.0.1:8000/docs**.

`make setup` is an alternative to the dependency-install steps above. It uses `python3.12` by default; override it with `make setup PYTHON=/path/to/python3.12` when necessary. No example objects are seeded by default. Follow [the live workflow guide](docs/LIVE_WORKFLOW.md) to enable the connected cloud pipeline.

### Camera feature merged from Fieldframe

The **Camera** menu opens **http://localhost:5173/camera**. It shares the same camera component as **Scan room**. Select **Camera preview only** to test video, front/back selection, JPEG compression, backend sharpness/brightness, and the three best frame candidates without Gemini. Select **Update shared memory** with Gemini enabled to save locations automatically. Camera captures once on start, then every 5 seconds by default (selectable 3, 4, or 5 seconds), with one upload in flight. The backend waits at least the selected interval after each Gemini result before analyzing the latest frame. Camera and Muse remain mounted across household screens. Both attempt to start by default, subject to browser permissions and stored on/off choices. See [persistent assistance](docs/ASSISTANCE_SESSION.md).

The [connected image workflow](docs/IMAGE_PIPELINE.md) saves frames to the team database, reads them back into Onyu’s process_capture pipeline, then atomically writes current objects, history and retained photo evidence. MEMORY_PROVIDER=spacetimedb makes both the memory page and Muse read those shared records. The tables have been published to the current team database with approval; see [activation and tests](docs/LIVE_WORKFLOW.md).

After pulling this merge, keep your existing `.env` and update the backend dependencies:

```bash
.venv/bin/python -m pip install -r services/api/requirements-dev.lock
.venv/bin/python -m pip install --no-deps -e services/api
```

Then restart `make api` and `make web`. No separate camera server or WebSocket proxy is required. The original `camera_capture/` standalone prototype remains available; the main API reuses its OpenCV `TopFrameSelector`. See [camera setup and limits](docs/LIVE_SCAN.md).

### Try the shared-memory demo

1. Enable Gemini vision using the settings below and restart `make api`.
2. Join as **Pree**, open **Scan room**, select **Update shared memory**, stop if necessary, choose the room and memory-analysis interval, then restart, then press **Start scanning** and grant camera permission.
3. Keep a distinctive object visible. Each processed frame saves its image, box, location, and timestamp automatically. No manual object entry is needed.
4. Open another browser session and join as **Alex**, then search for that object or ask Muse. Both users see the same household memory, with no contributor name.
5. While keeping the object visible in the same scan, move it to another surface and wait for a processed frame. The second session polls every five seconds; a new Muse question reads fresh evidence.
6. Stop scanning before leaving. Switching household screens keeps it running; hiding the website or leaving stops it; an already-uploaded frame may finish on the backend.

Without Gemini credentials, use **Camera preview only**; shared-memory scanning is disabled and no placeholder objects are added. Automatic association is provisional: a unique, unchanged label and appearance can reuse an ID across adjacent frames in the same scan/room. Ambiguous objects or changed descriptions create separate candidates. See [live camera scanning and limits](docs/LIVE_SCAN.md).

See [the three-minute demo script](demo/README.md).

## Repository layout

```text
apps/web/                         React + TypeScript + Vite frontend
  src/components/                 Camera, evidence image, accessible dialog
services/api/
  commonplace_api/main.py        HTTP endpoints and session authorization
  commonplace_api/store.py       SQLite reference implementation
  commonplace_api/vision.py      Gemini adapter and image normalization
  commonplace_api/muse.py        Muse shared-memory tool loop
  commonplace_api/voice.py       Muse Voice Transcribe and audio validation
  commonplace_api/storage.py     Persistent host image storage
  commonplace_api/frame_sink.py  Upload and exact-byte database readback
  commonplace_api/object_memory.py Shared object/history/image storage and worker orchestration
  tests/                          API, permissions, evidence, provider tests
camera_capture/                  Original camera prototype and shared OpenCV quality selector
services/worker/                  Connected Onyu pipeline; optional depth and embeddings
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

Camera ingestion returns quality/status immediately and feeds an in-process backend worker. It keeps one active inference and one latest pending frame per scan, with a bounded provider timeout. The legacy `/api/captures` endpoint remains synchronous. A durable distributed queue is still a later step. For the asynchronous design, see [the worker contract](services/worker/README.md).

## Use Ask Muse

The household **Ask Muse** screen is the only assistant UI. Configure the repository-root `.env`:

```dotenv
ASSISTANT_PROVIDER=muse
MODEL_API_KEY=your-private-meta-api-key
META_MODEL=muse-spark-1.3
META_VOICE_MODEL=muse-voice-transcribe-1.0
```

Choose model IDs enabled for your Meta project. Keep keys on the backend, never in `VITE_*` settings or frontend source.

Run `make api` and `make web` in separate terminals. Open **http://localhost:5173/**, enter a guest name, and choose **Ask Muse**. The API initializes its local SQLite store automatically; a separate hosted database and Gemini vision are not required to test chat against existing sample records. For local-only testing, use `GUEST_PROFILE_STORE=local`, `CAMERA_FRAME_SINK=disabled`, `VISION_PROVIDER=demo`, and `STORAGE_PROVIDER=local`.

Typing, **Talk to Muse**, **Dictate a message**, **Read replies aloud**, and **Hello** activation remain available. Voice questions are transcribed by Meta; replies use the browser/device voice. Listening requires a supported browser, permission, and a visible page. Chat remains mounted while navigating household screens and clears on reload or guest switch.

Old standalone-page bookmarks redirect to the household assistant. The separate test backend and launch commands have been retired. Follow [Muse setup and testing](docs/MUSE_TESTING.md) for the full runbook and [voice acceptance checks](docs/ACCESSIBILITY.md) for device testing.

## How Muse uses shared household memory

Set `ASSISTANT_PROVIDER=muse` with the same Meta credentials, then use the normal `make api` + `make web` flow at `/` and join with your name. The full local app uses its existing SQLite store and guest sessions. Muse requests a read-only `search_household_memory` tool; FastAPI scopes the lookup to the session's shared demo household, reads fresh records, and returns evidence. Unknown/ambiguous matches get deterministic no-match/clarification responses. Images and observation history remain available; new camera observations carry no contributor identity. Legacy report endpoints remain for compatibility, without manual entry controls in the app.

Location updates come from **Scan room**, and earlier chat answers remain snapshots. The Gemini assistant adapter remains available for optional compatibility testing via `ASSISTANT_PROVIDER=gemini`; it is not used in the Muse flow.

## Host on Vultr and connect SpacetimeDB

Follow the [Vultr + GoDaddy deployment guide](docs/DEPLOYMENT.md). It uses Ubuntu, Nginx and systemd; no local container tooling is needed. SQLite memory, sessions and evidence photos stay in a persistent `DATA_DIR` outside code releases.

For saved guests, the backend can use the team's existing public `user` table through `SPACETIMEDB_PROFILE_TABLE=user`; see [saved-user setup](docs/USERS.md). Each new name gets a separate anonymous database identity. No module publication or owner token is needed for that adapter. The camera has a separate append-only image stream connector; see [image delivery](docs/IMAGE_PIPELINE.md). For live object records set MEMORY_PROVIDER=spacetimedb and follow [the connected workflow](docs/LIVE_WORKFLOW.md); SQLite is retained for app sessions and optional local memory.

The optional `GET /api/connector/search` endpoint and `make connector` gateway remain available for external experiments. The active assistant uses Meta Model API directly.

## Configuration

Copy `.env.example` to `.env`. Defaults work without credentials.

| Setting                                                 | Purpose                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `APP_ENV`                                               | `development` locally or explicit `prototype` guest mode for a demo                          |
| `GUEST_PROFILE_STORE`                                   | `auto` (default), `local` (reset on API restart), `sqlite`, or `spacetimedb`; profiles only  |
| `SPACETIMEDB_PROFILE_ACCESS`                            | `private` (default; owner token) or `public` (public guest-table addition; no runtime token) |
| `SPACETIMEDB_PROFILE_TABLE`                             | `user` for the existing team table, or `guest_profile` for a registry module                 |
| `SPACETIMEDB_SERVER_TOKEN`                              | Backend-only owner credential for the optional private SpacetimeDB profile registry          |
| `MEMORY_PROVIDER`                                       | sqlite for local compatibility, spacetimedb for the connected Onyu/shared-memory path        |
| `SEED_SAMPLE_DATA`                                      | false by default; hide old samples without deleting them                                     |
| `VISION_ENRICHMENT`                                     | geometry by default; models enables optional Depth Anything/SigLIP                           |
| `DATA_DIR`                                              | Local database and image directory; relative to the repository root                          |
| `VISION_PROVIDER`                                       | `demo` or `gemini`                                                                           |
| `ASSISTANT_PROVIDER`                                    | `disabled` (default), `muse`, or optional `gemini`; independent of vision                    |
| `MODEL_API_KEY`, `META_MODEL`, `META_VOICE_MODEL`       | Backend-only Muse chat and transcription settings                                            |
| `GEMINI_CHAT_API_KEY`                                   | Optional previous Gemini assistant key                                                       |
| `GEMINI_VISION_API_KEY`, `GEMINI_MODEL`                 | Backend-only photo-analysis credentials/model                                                |
| `GEMINI_API_KEY`                                        | Optional legacy shared-key fallback; role-specific keys take precedence                      |
| `GEMINI_CHAT_MODEL`                                     | Function-calling model for chat; falls back to `GEMINI_MODEL`                                |
| `STORAGE_PROVIDER`                                      | `local`; persistent evidence files under DATA_DIR                                            |
| `CAMERA_FRAME_SINK`                                     | `disabled` (default) or `spacetimedb`; forwards live camera frames to the team image stream  |
| `CAMERA_SPACETIMEDB_URL`, `CAMERA_SPACETIMEDB_DATABASE` | Image-ingestion server/database; may match the guest database with the user adapter          |
| `CAMERA_SPACETIMEDB_TOKEN`                              | Optional upload credential; the current public upload reducers accept anonymous calls        |
| `CORS_ORIGINS`                                          | Explicit comma-separated origins for direct API callers                                      |
| `MAX_UPLOAD_BYTES`                                      | Per-image limit, default 8 MiB                                                               |

Use a new `DATA_DIR` for a fresh rehearsal without deleting existing memory. Switching image storage does not migrate previously saved photographs; keep a consistent provider for a dataset.

Guests enter a display name at `/` and receive a random 24-hour session. No password or email is collected. The frontend stores the token in browser `sessionStorage`, while SQLite stores only its hash. Reloading the same tab restores it; **Household** offers a **Saved users** picker, a new-user form, and **Leave guest session**. Selecting a saved user restores their ID with a new token. Switching or leaving revokes the prior token, and changing guests clears the assistant conversation. Entering the same name twice creates separate guest IDs; it does not select another user's identity.

**User storage:** `GUEST_PROFILE_STORE=auto` defaults to a temporary in-process user list when no SpacetimeDB server token is configured and profile access remains `private`. Restarting `make api` resets selectable users and invalidates their old sessions; refreshing the browser alone does not. Images and object history are retained separately. New observations do not store a contributor; legacy actor fields are omitted from API and assistant results. Use `sqlite` for local persistence or configure SpacetimeDB for the profile registry. Use the existing public `user` table without publication, or see [adding a separate guest table](spacetimedb/guest-table/README.md), [the separate public users-only registry](spacetimedb/users/README.md), and [saved-user setup](docs/USERS.md). The current team image module now has the additional live-memory tables; the older users-only/private module alternatives remain separate.

All guests share the `demo-home` prototype household. Names support the user picker; they are not attached to new object observations or verified private-household accounts. There is no app subscription or payment flow. Host and model-provider usage have separate billing. `APP_ENV=prototype` explicitly permits this name-only demo; `APP_ENV=production` still rejects startup because private verified-user authentication is not implemented. The old fixed-profile API is retained only in development for compatibility; the UI uses `POST /api/guest/session`.

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

Browser tests launch the household API on port 8011 and frontend on 5174 and use a separate directory under `.data/browser-tests/`. They cover search, a report shared between two browser sessions, truthful empty states, mobile overflow, live scan intervals/cancellation/permission failures, camera-only OpenCV diagnostics, and assistant UI/error behavior. Meta/Gemini transports and audio responses are mocked in automated tests; these do not establish actual iPhone microphone/camera behavior, speech quality, or live account connectivity.

## Next implementation milestones

1. Keep name-only guest mode for the prototype; add verified sign-in and private household membership if the project later needs private accounts.
2. Replace API polling with appropriate live subscriptions if needed; the camera/object/Muse SpacetimeDB path is already connected.
3. Extract capture processing into durable jobs with retries, leasing, and idempotent result commits.
4. Add explicit object identity confirmation across captures.
5. Verify Muse chat/voice and Gemini image analysis with their respective project credentials, then deploy the API/frontend to Vultr.
6. Rehearse with real household objects on two phones; add a domain after deployment works.

Full SLAM, metric 3D navigation, closed-browser/background-phone capture, and physical direction arrows are outside this starter's scope.

Licensed under [MIT](LICENSE).
