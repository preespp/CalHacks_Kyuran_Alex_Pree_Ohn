# API and coordinate contract

The running OpenAPI schema at <http://127.0.0.1:8000/openapi.json>, interactive `/docs`, `services/api/commonplace_api/models.py` and `apps/web/src/types.ts` define the request/response contract. All normal application endpoints require an app bearer token except health, docs, saved-name listing and guest-session creation. Prototype display names are unverified.

| Method     | Route                           | Role                                                                        |
| ---------- | ------------------------------- | --------------------------------------------------------------------------- |
| GET        | `/api/health`                   | Selected providers/configuration; not proof of working external credentials |
| GET        | `/api/guest/users`              | Saved names and registry storage notice                                     |
| POST       | `/api/guest/session`            | New name or existing user ID; optional previous bearer is revoked           |
| DELETE     | `/api/guest/session`            | Revoke current session (API capability, not a current menu button)          |
| GET        | `/api/me`                       | Current member                                                              |
| GET        | `/api/objects?q=...&room=...`   | Search/filter household objects                                             |
| GET        | `/api/objects/{id}/history`     | Saved observation history                                                   |
| GET        | `/api/activity`                 | Household timeline                                                          |
| GET        | `/api/images/{key}`             | Authorized saved evidence                                                   |
| POST       | `/api/camera/frames`            | JPEG ingestion, quality and optional asynchronous recognition               |
| GET/DELETE | `/api/camera/streams/{scan_id}` | Analysis status / stop queued scan work                                     |
| POST       | `/api/captures`                 | Legacy synchronous image capture                                            |
| POST       | `/api/chat`                     | Read-only evidence-backed assistant                                         |
| POST       | `/api/voice/transcribe`         | Recorded question transcription                                             |
| GET        | `/api/connector/search?q=...`   | Optional read-only integration endpoint                                     |
| POST       | `/api/objects/{id}/notes`       | Legacy local-memory report; remote live mode rejects it                     |

The old fixed-profile/demo endpoints are development compatibility only. `/api/lab/...` is retired. The old `/muse` bookmark redirects to the integrated chat, not a standalone app.

Guest creation accepts exactly one of `{name}` or `{user_id}`. Names are trimmed, single-line, 1–50 characters. Response fields include `token`, `member` and `expires_in` (86400 seconds). A new name creates a separate ID even if it repeats another name. Clients cannot choose a household.

Objects expose `id`, `label`, `appearance`, `aliases`, `latest` and `last_visual`. Observations include room, location, source, capture time, image reference and normalized box, with no contributor identity in the API contract. `last_visual` can predate a newer nonvisual report; it is not proof of that report's location. UI details and prior answers can be snapshots; query again for fresh evidence.

Image boxes use `[xmin, ymin, xmax, ymax]` in **0–1 image coordinates**, after image normalization. Gemini's raw `[ymin, xmin, ymax, xmax]` 0–1000 output is converted and validated on the backend. These coordinates and optional relative depth do not establish physical map positions, metric distance or walking directions.

The actual retained remote database contract is documented in [the pipeline guide](../docs/IMAGE_PIPELINE.md); the private module under `spacetimedb/src` is not an interchangeable schema.
