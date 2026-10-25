# Configuration reference

Local configuration lives in the repository-root `.env`; process environment variables take precedence. Copy `.env.example` only for first setup. Restart FastAPI after changing backend settings. Hosted values belong in Azure application settings or the optional Vultr environment file. Never commit real keys or expose them through `VITE_*` settings.

## Storage and runtime

| Variable           | Values and behavior                                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`          | `development` locally; `prototype` for the hosted name-only app. `production` rejects startup because verified private accounts are not implemented.                                                |
| `DATA_DIR`         | Local SQLite sessions and optional local images/memory. Relative paths resolve against the source root. Use `/tmp/remi` for the Azure prototype; see its persistence limitation in the Azure guide. |
| `MEMORY_PROVIDER`  | `sqlite` for local object/observation storage; `spacetimedb` for live shared object/image records. Remote memory requires the camera sink below.                                                    |
| `SEED_SAMPLE_DATA` | `false` normally. `true` explicitly enables labeled local illustration fixtures. False hides samples without deleting them.                                                                         |
| `STORAGE_PROVIDER` | Only `local` is supported by this adapter. Remote live evidence is served by the SpacetimeDB memory adapter independently.                                                                          |
| `MAX_UPLOAD_BYTES` | Upload limit, default 8 MiB. Backend rejects invalid or oversized images.                                                                                                                           |
| `CORS_ORIGINS`     | Comma-separated allowed origins, without paths. Local defaults allow localhost/127.0.0.1:5173.                                                                                                      |

## Assistant and vision

| Variable                                   | Meaning                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `ASSISTANT_PROVIDER`                       | `disabled`, `muse` (normal Remi provider), or optional `gemini` compatibility adapter.                                |
| `MODEL_API_KEY`, `META_MODEL`              | Meta API key and model ID available to your project.                                                                  |
| `META_VOICE_MODEL`                         | Meta transcription model; current code default is `muse-voice-transcribe-1.0`.                                        |
| `VISION_PROVIDER`                          | `demo` disables real recognition; `gemini` enables image analysis. A key alone does not enable vision.                |
| `GEMINI_VISION_API_KEY`, `GEMINI_MODEL`    | Dedicated vision key and an accessible image/JSON-capable model ID.                                                   |
| `VISION_ENRICHMENT`                        | `geometry` avoids local ML weights; `models` adds optional depth/embedding models after installing the spatial extra. |
| `GEMINI_CHAT_API_KEY`, `GEMINI_CHAT_MODEL` | Optional Gemini chat compatibility settings; not needed for normal Meta chat.                                         |
| `GEMINI_API_KEY`                           | Legacy fallback when a role-specific Gemini key is empty.                                                             |

Model IDs have no URL or `models/` prefix. Provider billing, model access and quotas must be checked in the actual project dashboard; a free allowance or promotional credit is not assumed by this app.

## Live camera/object memory

Set `CAMERA_FRAME_SINK=spacetimedb`, `CAMERA_SPACETIMEDB_URL` to the server origin and `CAMERA_SPACETIMEDB_DATABASE` to the database name/identity. `CAMERA_SPACETIMEDB_TOKEN` is an optional matching backend credential when reducer permissions require it. `disabled` keeps preview/quality checks local to the API.

For live memory, also set `MEMORY_PROVIDER=spacetimedb`. Upload, readback and commit reducers must already exist. See [image pipeline](IMAGE_PIPELINE.md); setting a URL does not publish tables.

## Saved household names

`GUEST_PROFILE_STORE=local` resets selectable names when the API process restarts; `sqlite` persists them in DATA_DIR; `spacetimedb` requires the remote registry. `auto` is a compatibility mode selecting a remote registry when its token/public-access configuration is present, with temporary fallback for a missing database; permission/schema/network failures remain visible.

For the team's existing public `user` table, use `SPACETIMEDB_PROFILE_TABLE=user`, `SPACETIMEDB_PROFILE_ACCESS=public`, `SPACETIMEDB_URL` and `SPACETIMEDB_DATABASE`. A separate `guest_profile` module is an alternative, not a prerequisite. `SPACETIMEDB_SERVER_TOKEN` is the registry adapter's backend credential when required. It is separate from the camera token. All these configurations still use local SQLite bearer-session hashes.

## Browser and development settings

`API_PROXY_TARGET` sets Vite's development API proxy (default API port 8000). `VITE_MEDIA_AUTOSTART=false` disables the camera's initial attempt for manual/testing use; it does not disable Remi's automatic wake listener. Camera/voice still require permission, a supported browser and a visible page. Voice choice, rate and volume are saved in browser localStorage; guest sessions and camera preferences are browser-session state.

`COMMONPLACE_CONNECTOR_TOKEN` belongs only to the optional read-only connector gateway; it is an app session credential, never a provider key. `SCM_DO_BUILD_DURING_DEPLOYMENT=true` is an Azure build setting. See [Azure deployment](AZURE_APP_SERVICE.md) before applying any hosting configuration.
