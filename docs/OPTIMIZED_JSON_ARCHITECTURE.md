# Onyu’s spatial vision pipeline and live integration

The connected implementation and measured verification are documented in [LIVE_WORKFLOW.md](LIVE_WORKFLOW.md). This replaces the earlier standalone prototype description, example payloads and unverified performance claims.

`services/worker/pipeline.py` now receives the exact saved camera JPEG from SpacetimeDB, calls Gemini once for labels/appearance/location/normalized boxes, derives zones and image-plane relations, and produces validated records for the atomic shared-memory commit. The database retains actual image references and capture timestamps; no example household/photo/contributor is inserted.

`VISION_ENRICHMENT=geometry` uses real Gemini results and geometric relations without downloading local neural models. Exact unique label/appearance matches can reuse object IDs conservatively. `VISION_ENRICHMENT=models` enables the optional Depth Anything V2 Small and SigLIP crop-embedding stages after installing the API spatial extra. Their latency and hardware requirements must be measured on the deployment machine; no fixed FPS or sub-200ms guarantee is made.

Depth values are relative within an image. Rankings may identify the closest observed object in that photo; they do not provide calibrated meters, room coordinates, camera pose or walking directions. The experimental RealtimeStreamEngine no longer converts relative depth to a fabricated metric distance. It remains separate from the web app’s bounded camera-job callback.

The shared result schema uses object_memory for current records, object_sighting for history and vision_capture for retained evidence. Muse and the household page read the same remote records. App bearer sessions remain local SQLite hashes; guest names remain in the separate user adapter. Object observations contain no contributor attribution.
