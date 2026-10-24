# Vision worker milestone

The first scaffold processes real captures in `services/api/commonplace_api/main.py` during the request. `vision.py` is the reusable provider adapter. This directory documents the extraction boundary; it does not contain a fake running worker.

When introducing the worker:

1. The API authorizes the member, normalizes/uploads the image, and atomically creates a durable job.
2. A worker claims a job through a short transaction with a lease and bounded attempt count.
3. It calls Gemini outside the database transaction.
4. It validates all observations and resolves candidate object identity conservatively.
5. A granted service identity commits observations and completes the job atomically.
6. The UI subscribes to job status and household views.

Use a unique household/request ID for idempotency. Persist image receipt time separately from inference completion time so slow results do not supersede newer sightings. Retry transient provider failures with bounded backoff; do not retry invalid images or malformed observations indefinitely. Release/expire leases after worker crashes. Clean up orphan uploads and define image retention.

The intended jobs and subscriptions live in SpacetimeDB; a second cloud database or message broker is not required for the first worker version.
