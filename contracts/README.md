# API contract

The running FastAPI application is the source of truth:

- Interactive documentation: `http://127.0.0.1:8000/docs`
- OpenAPI schema: `http://127.0.0.1:8000/openapi.json`
- Input validation: `services/api/commonplace_api/models.py`
- Frontend response types: `apps/web/src/types.ts`

Except for health, API documentation, and demo session creation, application endpoints require `Authorization: Bearer <session-token>`.

| Method | Route                         | Purpose                                                 |
| ------ | ----------------------------- | ------------------------------------------------------- |
| GET    | `/api/health`                 | Report actual selected providers and sync mode          |
| POST   | `/api/demo/session`           | Select a development profile; returns a 24-hour session |
| GET    | `/api/me`                     | Current member                                          |
| GET    | `/api/objects?q=...&room=...` | Household-scoped token/alias search                     |
| GET    | `/api/objects/{id}/history`   | Observation history                                     |
| POST   | `/api/objects/{id}/notes`     | Record a moved/found/correction report                  |
| GET    | `/api/activity`               | Recent household observations and reports               |
| GET    | `/api/images/{key}`           | Authorized image access                                 |
| POST   | `/api/demo/captures`          | Add a known, explicitly labeled sample observation      |
| POST   | `/api/captures`               | Multipart image, room, request_id; requires Gemini mode |
| GET    | `/api/connector/search?q=...` | Read-only, evidence-backed household search             |
| POST   | `/api/chat`                   | Muse assistant; authorized read-only memory search      |
| POST   | `/api/voice/transcribe`       | Authorized Muse speech-to-text from a WAV upload        |

Coordinates are `[xmin, ymin, xmax, ymax]` floats from 0 to 1, relative to the EXIF-normalized source image. The frontend displays the whole image with `object-fit: contain` and overlays the box in that same aspect ratio. It does not draw a saved box on a new camera frame.

An object's `latest` observation determines its reported/last-seen location. Its separate `last_visual` may be older. A member report has `image_url=null` and `bbox=null`. Evidence sources are `sample`, `gemini`, and `reported`; consumers must preserve that distinction.

For uploads, reuse a request ID when retrying the same bytes and room. A reused ID with a different image or room returns 409. New request IDs create new candidate objects. Automatic physical object association is not yet implemented.

Chat accepts `{"message":"Where is our adapter?","history":[]}`. `message` is at most 1000 characters; history permits up to eight `{role: "user" | "assistant", content: string}` entries of at most 2000 characters each. Neither clients nor model tools can supply a household ID. Only the authenticated session selects it.

The response contains `provider`, `answer`, `query`, `matches` (up to eight standard object records), `total_matches`, and `needs_disambiguation`. Evidence is a snapshot of that request; a later question searches again. Chat performs at most two model requests and exposes no write tool. Empty matches and ambiguity receive deterministic messages after the search. Status codes include 401 for invalid sessions, 409 for disabled chat, 422 for invalid input, 429 for provider quota, and 502 for upstream/invalid responses. Errors do not silently become sample answers or trigger automatic retries. `provider` is `muse` for the active Meta adapter, or `gemini` for the optional previous adapter.

The independent local backend on port 8002 exposes `GET /api/lab/health`, `POST /api/lab/chat`, and `POST /api/lab/transcribe` only, plus API docs. It has no household login or database routes. Lab chat accepts the same bounded text/history shape but returns only `{provider: "muse", answer: string}` and has no memory tools. Local host/origin checks replace public exposure; this is not a production authentication scheme.

Both transcription routes accept multipart `audio`: a mono, 16-bit PCM WAV at 16 or 24 kHz, at most 30 seconds and 2 MiB. They return `{provider: "muse", text: string}` with at most 1000 characters. Invalid clips are rejected before Meta usage. The browser converts microphone recordings to the supported format. Manual dictation keeps the transcript editable before Send. In an explicitly started Talk to Muse session, detected speech followed by silence automatically triggers transcription and then a separate chat request; successful reply playback permits the next listening turn. Stopping cancels callbacks and prevents late transcripts from sending another chat request. Spoken output uses browser speech synthesis rather than another backend API.
