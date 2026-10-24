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

Coordinates are `[xmin, ymin, xmax, ymax]` floats from 0 to 1, relative to the EXIF-normalized source image. The frontend displays the whole image with `object-fit: contain` and overlays the box in that same aspect ratio. It does not draw a saved box on a new camera frame.

An object's `latest` observation determines its reported/last-seen location. Its separate `last_visual` may be older. A member report has `image_url=null` and `bbox=null`. Evidence sources are `sample`, `gemini`, and `reported`; consumers must preserve that distinction.

For uploads, reuse a request ID when retrying the same bytes and room. A reused ID with a different image or room returns 409. New request IDs create new candidate objects. Automatic physical object association is not yet implemented.
