# Connected vision worker

The normal web pipeline calls `process_capture` in [pipeline.py](pipeline.py) after exact-byte database readback. It uses Gemini detections and returns validated object/sighting payloads for the remote memory adapter's atomic commit. Remi and the object list read the same resulting records. See [image pipeline](../../docs/IMAGE_PIPELINE.md).

The default `VISION_ENRICHMENT=geometry` requires no local PyTorch weights. It adds image zones/relations and conservatively matches unique label/appearance descriptions within a room. Ambiguous or changed descriptions may produce another candidate. `models` adds relative depth and crop embeddings:

```bash
.venv/bin/python -m pip install -e 'services/api[spatial]'
```

That optional install can require substantial downloads, RAM and inference time; measure it on the intended host before enabling it. Depth is relative within an image and is not converted into calibrated meters. The default Azure package/configuration uses geometry mode.

`RealtimeStreamEngine`, stitching and the [manual JSON experiment](../../scripts/experiments/generate_memory_json.py) are separate from the web request callback. They are not a background watcher for all uploaded historical images. Camera jobs live in the API process and pending work can be lost on restart; durable distributed jobs are not implemented.

Worker geometry/matching tests now live under `services/api/tests/test_worker_relations.py` and run with `make test`, alongside pipeline integration tests. No model downloads are required for those automated checks.
