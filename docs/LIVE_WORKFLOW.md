# Live workflow quick reference

For first setup use [Setup](SETUP.md#enable-the-live-workflow). The canonical stage-by-stage description and database contract are in [Image pipeline](IMAGE_PIPELINE.md).

The normal path is browser JPEG → FastAPI normalization → SpacetimeDB upload/readback → connected Gemini worker → atomic capture/object/sighting commit → frontend refresh and Remi lookup. The assistant is Meta Muse; Gemini is the vision provider. Saved names use the independent user adapter, and bearer sessions remain SQLite.

The read-only diagnostic can inspect configured providers and the remote schema without generating images or making model calls:

```bash
.venv/bin/python scripts/check_pipeline.py
```

It verifies table/reducer presence and configuration, not actual upload/commit permissions or successful recognition. Use [the live acceptance checks](TESTING.md#full-workflow-acceptance) for those. Do not reset or republish the shared database as a diagnostic shortcut.
