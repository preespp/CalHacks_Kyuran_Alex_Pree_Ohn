# API contract

The running FastAPI application is the source of truth:

- Interactive documentation: `http://127.0.0.1:8000/docs`
- OpenAPI schema: `http://127.0.0.1:8000/openapi.json`
- Input validation: `services/api/commonplace_api/models.py`
- Frontend response types: `apps/web/src/types.ts`

Except for health, API documentation, and guest session creation (plus the development-only fixed-profile endpoint), application endpoints require `Authorization: Bearer <session-token>`.

| Method | Route                         | Purpose                                                     |
| ------ | ----------------------------- | ----------------------------------------------------------- |
| GET    | `/api/health`                 | Report actual selected providers and sync mode              |
| GET    | `/api/guest/users`            | List selectable prototype users and storage notice          |
| POST   | `/api/guest/session`          | Join the prototype household with a display name only       |
| DELETE | `/api/guest/session`          | Leave and revoke the current guest session                  |
| POST   | `/api/demo/session`           | Select a development profile; returns a 24-hour session     |
| GET    | `/api/me`                     | Current member                                              |
| GET    | `/api/objects?q=...&room=...` | Household-scoped token/alias search                         |
| GET    | `/api/objects/{id}/history`   | Observation history                                         |
| POST   | `/api/objects/{id}/notes`     | Legacy location report; no manual-entry UI                  |
| GET    | `/api/activity`               | Recent household observations and reports                   |
| GET    | `/api/images/{key}`           | Authorized image access                                     |
| POST   | `/api/demo/captures`          | Legacy sample fixture endpoint; no manual-entry UI          |
| POST   | `/api/camera/frames`          | Frame ingestion/quality; optional backend memory analysis   |
| POST   | `/api/captures`               | Multipart image, room, request_id, optional scan_id; Gemini |
| GET    | `/api/connector/search?q=...` | Read-only, evidence-backed household search                 |
| POST   | `/api/chat`                   | Muse assistant; authorized read-only memory search          |
| POST   | `/api/voice/transcribe`       | Authorized Muse speech-to-text from a WAV upload            |

`GET /api/guest/users` returns `{users: [{id, household_id, name}], storage: "local" | "sqlite" | "spacetimedb", notice}`. This is intentionally accessible before login for the shared prototype. The backend's SpacetimeDB token is never returned.

Guest entry accepts `POST /api/guest/session` with either `{"name":"Pree"}` to add a user or `{"user_id":"guest-<32 hex characters>"}` to select an existing one. Exactly one is required; unknown valid-format user IDs return 404. Names are trimmed, 1–50 characters, and single-line. Clients cannot choose a household. The response is `{token, member: {id, name, household_id}, expires_in: 86400}`. A new name creates a separate guest ID even if reused; choosing a saved user preserves that ID. Supplying an existing bearer token while joining replaces/revokes that token. `DELETE /api/guest/session` requires a valid token and revokes it, returning 204 with no body.

Temporary profiles reset on backend restart and their old sessions become invalid; persistent registry modes retain the selectable profile IDs. Image/object storage and local session hashes are separate. Names remain unverified labels in the shared `demo-home` prototype. `/api/demo/session` remains a development compatibility endpoint and returns 404 with `APP_ENV=prototype`.

Shared-memory objects, history, activity, and tool results omit `actor_id` and `actor_name`. New observations do not record a contributor; guest profile/session names remain separate.

Coordinates are `[xmin, ymin, xmax, ymax]` floats from 0 to 1, relative to the EXIF-normalized source image. The frontend displays the whole image with `object-fit: contain` and overlays the box in that same aspect ratio. It does not draw a saved box on a new camera frame.

An object's `latest` observation determines its reported/last-seen location. Its separate `last_visual` may be older. A member report has `image_url=null` and `bbox=null`. Evidence sources are `sample`, `gemini`, and `reported`; consumers must preserve that distinction.

For uploads, reuse a request ID when retrying the same bytes and room. A reused ID with a different image or room returns 409. If `scan_id` is supplied, it is part of the fingerprint; a different scan ID also returns 409 on request-ID reuse. Use one scan ID for a running scan and a distinct request ID per frame. Without a scan ID, each capture creates new candidates. With one, a provisional adjacent-frame label/appearance match may reuse an ID; see [association limits](../docs/LIVE_SCAN.md). The response is `{capture_id, object_ids, count, source, superseded, frame_stats}`. `frame_stats` is nullable (including cached retries) and contains the temporary camera diagnostics described below. Older frames within the same scan return `superseded: true` with no updates; successful empty frames preserve last-seen records. `scan_id` is 8–100 ASCII letters, digits, underscores, or hyphens.

`POST /api/camera/frames` accepts multipart `image`, required `scan_id`, optional `room` (default Living room), `memory_enabled` (default false), and `analysis_interval` (1–30 seconds, default four). It requires a guest session and validates the same image/scan-ID limits as captures. Preview needs no model key. Memory mode requires Gemini and offers the latest frame to the bounded backend worker without awaiting inference.

The response is `{received_frames, received_fps, quality, top_frames, analysis}`. Quality entries contain `{frame_id, width, height, sharpness, brightness, quality_score}`; at most three top entries are returned, with no JPEG bytes. `analysis` contains `{state, processed_frames, count, observed_at, error}`, where state is disabled, waiting, processing, or error. GET `/api/camera/streams/{scan_id}` returns analysis status; DELETE cancels pending work and returns 204. All stream keys are household-scoped. Preview never writes object memory; memory mode saves only analyzed frames. Uploads target 10 FPS while analysis is throttled independently. See [worker and lifecycle rules](../docs/ASSISTANCE_SESSION.md).

Diagnostics remain bounded and temporary. `received_fps` averages intervals between received diagnostic frames and is zero for the first frame. Ingestion is not a durable/idempotent frame archive. The worker stores observations through the existing atomic capture commit. The legacy synchronous `/api/captures` endpoint and its idempotency contract remain available.

Chat accepts `{"message":"Where is our adapter?","history":[]}`. `message` is at most 1000 characters; history permits up to eight `{role: "user" | "assistant", content: string}` entries of at most 2000 characters each. Neither clients nor model tools can supply a household ID. Only the authenticated session selects it.

The response contains `provider`, `answer`, `query`, `matches` (up to eight standard object records), `total_matches`, and `needs_disambiguation`. Evidence is a snapshot of that request; a later question searches again. Chat performs at most two model requests and exposes no write tool. Empty matches and ambiguity receive deterministic messages after the search. Status codes include 401 for invalid sessions, 409 for disabled chat, 422 for invalid input, 429 for provider quota, and 502 for upstream/invalid responses. Errors do not silently become sample answers or trigger automatic retries. `provider` is `muse` for the active Meta adapter, or `gemini` for the optional previous adapter.

The independent local backend on port 8002 exposes `GET /api/lab/health`, `POST /api/lab/chat`, and `POST /api/lab/transcribe` only, plus API docs. It has no household login or database routes. Lab chat accepts the same bounded text/history shape but returns only `{provider: "muse", answer: string}` and has no memory tools. Local host/origin checks replace public exposure; this is not a production authentication scheme.

Both transcription routes accept multipart `audio`: a mono, 16-bit PCM WAV at 16 or 24 kHz, at most 30 seconds and 2 MiB. They return `{provider: "muse", text: string}` with at most 1000 characters. Invalid clips are rejected before Meta usage. The browser converts microphone recordings to the supported format. Manual dictation keeps the transcript editable before Send. In an explicitly started Talk to Muse session, detected speech followed by silence automatically triggers transcription and then a separate chat request; successful reply playback permits the next listening turn. Stopping cancels callbacks and prevents late transcripts from sending another chat request. Spoken output uses browser speech synthesis rather than another backend API.
