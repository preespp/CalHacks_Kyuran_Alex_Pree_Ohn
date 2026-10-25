# Camera → database → Gemini → shared memory

The active API uses the team module in `camera_capture/stream_module/src/index.ts`. The alternate module in `spacetimedb/src/index.ts` has a different private-household contract and must not replace it.

## Required live configuration

Use the existing backend keys and model IDs plus:

```dotenv
MEMORY_PROVIDER=spacetimedb
VISION_PROVIDER=gemini
VISION_ENRICHMENT=geometry
CAMERA_FRAME_SINK=spacetimedb
CAMERA_SPACETIMEDB_URL=https://maincloud.spacetimedb.com
CAMERA_SPACETIMEDB_DATABASE=YOUR_EXISTING_DATABASE_ID
SEED_SAMPLE_DATA=false
```

Copy an authorized `CAMERA_SPACETIMEDB_TOKEN` only when the deployed reducers require it. Saved user names have independent `SPACETIMEDB_*` settings; those settings alone do not enable image/object storage. Restart the API after changing configuration.

## Processing order

1. The scan dialog captures a JPEG and sends room, request ID, scan ID and analysis interval to `/api/camera/frames` with the app bearer token.
2. FastAPI validates/normalizes the image and computes quality diagnostics. The optional frame sink sends normalized bytes to `upload_binary_frame`.
3. The remote memory adapter retrieves the exact persisted session/sequence frame, validates the bytes and passes it to the connected worker.
4. The worker calls Gemini for visible objects and boxes. Geometry mode adds image-plane relations; optional models can add relative depth and embeddings.
5. The backend validates the result and invokes `commit_vision_capture`. The database commits evidence, current objects and append-only sightings together.
6. The frontend refreshes objects/activity every five seconds. A completed analysis currently closes the scan dialog. Remi's next question retrieves fresh records from the same memory store.

The camera-job callback runs inside the API process. It does not continuously watch every historical database row and is not an independent Gemini daemon. Upload acknowledgment, analysis completion and object-memory commit are separate states.

## Module tables

| Table                                 | Role                                                                  |
| ------------------------------------- | --------------------------------------------------------------------- |
| `user`, `message`                     | Existing prototype names/chat tables, preserved by the camera module. |
| `image_stream`, `image_stream_binary` | Image-delivery queues; binary is the integrated path.                 |
| `vision_capture`                      | Retained capture evidence.                                            |
| `object_memory`                       | Current object metadata and latest observation.                       |
| `object_sighting`                     | Observation history.                                                  |

Upload reducers validate frame content; acknowledgment reducers have their own permission checks. Public visibility is not a guarantee that every reducer accepts every caller. Read current source/deployed permissions before changing backend credentials. Do not delete or republish shared data to diagnose an upload problem.

## Diagnose by stage

- Preview fails: check browser permission, HTTPS/localhost and camera availability.
- `Invalid JPEG frame`: check normalization, reducer validation and the deployed frame contract. It is distinct from an authorization error.
- Upload succeeds but no objects: verify `VISION_PROVIDER=gemini`, the vision key/model, database readback, worker status and commit permissions/schema.
- Recognition succeeds but UI stays stale: verify `MEMORY_PROVIDER=spacetimedb`, the same database ID, selected room/search filters and the next refresh.
- User creation fails: diagnose the independent saved-user adapter; an image-upload credential does not configure users.

Remote images and observations remain saved across API restarts. In-process pending work does not. Similar objects can remain ambiguous, and not seeing an object in a new frame does not prove it moved or disappeared. See [tests](TESTING.md) and [worker internals](../services/worker/README.md).
