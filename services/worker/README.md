# Connected Onyu vision worker

The live web workflow now invokes `process_capture` in [pipeline.py](pipeline.py) after reading the uploaded image back from SpacetimeDB. Its validated results are committed through `commit_vision_capture` to `vision_capture`, `object_memory`, and `object_sighting`. The memory page and Muse read those same records. See [full workflow setup](../../docs/LIVE_WORKFLOW.md).

Set `MEMORY_PROVIDER=spacetimedb`, `VISION_PROVIDER=gemini`, `CAMERA_FRAME_SINK=spacetimedb` and `SEED_SAMPLE_DATA=false`. The shared database module must expose the new tables and reducer; the current team database has been updated with approval.

`VISION_ENRICHMENT=geometry` uses Gemini labels/boxes plus image zones, relations and conservative unique label/appearance association. Depth values/ranks are absent. It requires no PyTorch downloads. `VISION_ENRICHMENT=models` additionally uses Depth Anything and SigLIP; install `services/api[spatial]` and budget for weights, memory and inference time. Relative depth is never converted into uncalibrated meters.

The original `RealtimeStreamEngine` remains a separate experimental video runner; it is not the web app's production callback. The connected path uses one Gemini call per selected image and stores real timestamps and photo references, without a fabricated contributor or example photo URL.

`camera_jobs.py` provides one active job and one latest pending frame per scan. It is still in-process: pending jobs are lost on restart. There is no distributed leasing or automatic backfill of historical images. Durable jobs, bounded retries and retention are future work.
