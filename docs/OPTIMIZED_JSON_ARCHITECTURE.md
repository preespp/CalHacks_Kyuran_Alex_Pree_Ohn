# Vision JSON and optional enrichment

This is a reference to the current worker representation, not a separate production architecture or performance guarantee. See [architecture](ARCHITECTURE.md) and [the image pipeline](IMAGE_PIPELINE.md).

`services/worker/pipeline.py` returns tracked-object dictionaries with object ID, label, appearance, current room/summary, updated timestamp, latest sighting and optional embedding. A sighting includes capture ID, timestamp, photo reference, normalized box, image zones, optional relative depth/rank and relations. Durable history belongs to `object_sighting`; the worker payload is bounded to the current sighting.

`VISION_ENRICHMENT=geometry` uses Gemini detections, image-plane zones/relations and conservative unique label/appearance association. Local neural depth and embeddings are absent. `models` enables optional Depth Anything/SigLIP stages after installing the spatial extra. Their hardware use, startup time and latency need device measurement.

Relative depth does not establish metric distance, room coordinates, camera pose or walking directions. The experimental video runner is separate from the web API's camera-job callback. There is no guaranteed FPS or fixed sub-second inference budget. The frontend's category scenes are SVG illustrations, not a rendering of this JSON as a calibrated reconstruction.
