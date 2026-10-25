# Manual diagnostics and experiments

These commands run from the repository root with the installed `.venv`. They are separate from automated tests.

| Script                                | Purpose                                                                          | External effects                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `check_docs.py`                       | Validate local README/documentation link targets                                 | Local files only                                                                  |
| `check_pipeline.py`                   | Inspect live configuration and remote table/reducer presence                     | Reads the configured remote schema; no AI calls or database writes                |
| `test_meta_api.py`                    | Isolate Meta text-model access                                                   | One real provider request; can consume credits                                    |
| `test_gemini_api.py`                  | Optional legacy Gemini chat access; `--tools` uses synthetic memory              | Real provider requests; not a vision-pipeline check                               |
| `experiments/generate_memory_json.py` | Original image/folder/video worker experiment, formerly root `test_json_only.py` | Reads media, warms optional models, calls configured vision and writes local JSON |

Example diagnostics:

```bash
.venv/bin/python scripts/check_pipeline.py
.venv/bin/python scripts/test_meta_api.py
```

Run only the check you intend. Use accessible model IDs and keep secrets in backend `.env` or hidden prompts. The JSON experiment is not pytest: it needs the spatial extra/model downloads and its own input files. Inspect `--help` before running it. It does not replace the web app's database-backed workflow.

Automated worker tests were moved into `services/api/tests/` and are collected by `make test`. Follow [testing](../docs/TESTING.md) for local mocks, browser setup and live acceptance checks.
