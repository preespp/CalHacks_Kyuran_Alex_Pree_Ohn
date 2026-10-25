# Testing and troubleshooting

## Automated checks

From an installed checkout:

```bash
npm run check
.venv/bin/python scripts/check_docs.py
make test
npm run test:module
npx playwright install chromium
npm run test:browser
```

`npm run check` type-checks the frontend and TypeScript modules and builds React. API tests include worker unit checks and Azure entry/packaging tests. Module tests exercise the current camera contract and alternative registry/private-household permissions with local fixtures. Playwright exercises the current Remi interface against isolated local servers, with AI, audio and remote database responses mocked.

No real provider credits or shared database writes are needed. API pytest setup overrides live provider configuration and gives import-time application state a temporary directory. Browser servers use isolated local data, explicit provider settings and labeled sample fixtures. Do not point automated browser servers at your live backend.

## Browser setup

Playwright starts API port **8011** and Vite port **5174**, separate from normal development ports. Stop any stale process occupying those ports before running it. On Linux, `npx playwright install --with-deps chromium` also installs browser system dependencies. If a browser executable is missing, install it instead of skipping the suite.

On this Mac an installed Chrome can be used explicitly:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:browser
```

Run one feature or inspect a failure:

```bash
npm run test:browser -- tests/browser/camera.spec.ts
npm run test:browser -- tests/browser/room-scenes.spec.ts
npx playwright show-trace test-results/PATH_FROM_FAILURE/trace.zip
```

Browser specs are organized by app, chat, voice, wake handling, camera, memory, navigation, guests and room illustrations. Shared setup/mocks are in `tests/browser/support`. Old separate Muse-page and manual wake-toggle tests were replaced with the current app flows; they are not disabled tests waiting for an old UI to return.

## Live provider checks: run manually

```bash
.venv/bin/python scripts/test_meta_api.py
```

This sends a real Meta request using the backend key/model and may consume credits. It verifies API access, not household lookup, voice or camera. The optional `scripts/test_gemini_api.py` checks the legacy Gemini chat adapter, not the image pipeline. `--tools` uses synthetic local memory and may make two provider calls. These scripts do not belong to the automated test suite.

## Full workflow acceptance

1. Configure the real providers and the matching existing SpacetimeDB module, then restart the API.
2. Add/select a saved name. Confirm the chosen name is present after another browser opens the household.
3. Scan a room with a distinctive object visible. Confirm upload, recognition and memory commit separately; the dialog closes after completion.
4. In the second browser, wait for the next object refresh, search the object and inspect its source, time, saved photo and box.
5. Move the item and rescan the same room. Check the latest record; do not assume uncertain lookalikes will share an ID.
6. Ask Remi by typing and by a supported Remi wake phrase. An unknown object should receive no stored match, not an invented location.
7. Test microphone/camera refusal, hidden tabs, keyboard operation and audio output on your actual phone. See [accessibility](ACCESSIBILITY.md).
8. On the hosted site, repeat these checks over HTTPS. `/api/health` reports configuration, not successful third-party credentials.

## Common failures

| Symptom                                          | What to inspect                                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Blank app or no initial objects                  | API port/proxy, guest session, samples off by default, active search/room filter.                                    |
| Old browser stops updating after API replacement | Temporary registry/session expiration; try a fresh private window.                                                   |
| `POST /api/demo/session` returns 404             | Expected in prototype mode; current UI uses guest sessions.                                                          |
| `/api/lab/...` returns 404                       | Retired standalone testing backend; use the main app.                                                                |
| Camera blocked                                   | Permission, visible page, HTTPS/localhost and real front/back device access.                                         |
| Image upload succeeds but memory does not change | Recognition key/model, remote readback/commit contract and memory-provider selection.                                |
| Voice does not wake                              | Browser recognition support, microphone permission and complete phrase: Hey/Hello/Hi Remi. Typing remains available. |
| Azure startup/import fails                       | Remote build logs, dependency paths, packaged frontend and startup command.                                          |

Avoid debugging by deleting remote data or publishing a template over the shared module. Record the exact error and stage instead.
