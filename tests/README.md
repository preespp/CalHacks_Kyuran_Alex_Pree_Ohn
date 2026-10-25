# Test layout

| Location                  | Coverage                                                                                      | Command                   |
| ------------------------- | --------------------------------------------------------------------------------------------- | ------------------------- |
| `services/api/tests/`     | API auth, users, image/vision pipeline, providers, worker geometry/matching and Azure package | `make test`               |
| `spacetimedb/tests/`      | Camera contract, current public memory commit and alternative module permissions              | `npm run test:module`     |
| `tests/browser/*.spec.ts` | Current Remi UI and device-state behavior                                                     | `npm run test:browser`    |
| `tests/browser/support/`  | Fixtures, voice/camera mocks and shared helpers                                               | Imported by browser specs |

Follow [the testing guide](../docs/TESTING.md) for setup and focused commands. Browser tests start local API/frontend servers with isolated sample data. Provider calls and remote database operations are mocked; manual credit-consuming scripts live under `scripts/`, outside pytest's configured collection path.

Generated traces/screenshots/reports belong to ignored `test-results/` and `playwright-report/` folders. Do not commit tokens, recordings, personal photographs or machine-specific browser binaries as test fixtures.
