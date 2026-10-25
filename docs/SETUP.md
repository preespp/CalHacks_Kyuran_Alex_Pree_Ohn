# Accounts and cloud setup

Start with the empty local app using the root README, or follow [the connected live workflow](LIVE_WORKFLOW.md). Credentials are not required for camera preview. Sample records are off by default.

## Local tools

Use Node 24 from `.nvmrc`, Python 3.12, npm, and Git. Homebrew is optional. The root `Makefile` uses a project-local `.venv` and does not modify Anaconda.

Optional tools for later integration:

```bash
brew install uv
```

Install SpacetimeDB with its [official installer](https://spacetimedb.com/install), then run `spacetime login` when publishing requires developer authentication.

## Gemini

1. Sign in to [Google AI Studio](https://aistudio.google.com/).
2. Create/select a project and create an API key.
3. Check the models and quotas available to that project.
4. Test one real demo photo using an image-capable model with structured-output support.
5. For computer vision, set `VISION_PROVIDER=gemini`, `GEMINI_VISION_API_KEY`, and `GEMINI_MODEL` in the root `.env`, then restart the API.

The user-facing assistant now uses **Meta Muse**, with separate `MODEL_API_KEY` / `META_MODEL` settings. Gemini vision does not use that key. To test the assistant with local household memory and no hosted database or vision service, follow [Muse UI setup](MUSE_TESTING.md), run `make api` + `make web`, and choose **Ask Muse**. All secrets stay in the repository-root `.env`, never `VITE_*` or frontend source. The old Gemini assistant and standalone script remain optional compatibility experiments; they are not part of the Muse flow.

The API uses the official REST `generateContent` endpoint. Account availability, rate limits, and supported models can change; choose the model from your own project rather than copying a guessed model ID. See [API key setup](https://ai.google.dev/gemini-api/docs/api-key) and [image understanding](https://ai.google.dev/gemini-api/docs/image-understanding).

## Vultr hosting

Use a Vultr Ubuntu 24.04 server for Nginx, the built React frontend and one FastAPI process. The [deployment guide](DEPLOYMENT.md) covers account/server creation, SSH, installation, persistent files, GoDaddy DNS, HTTPS and future releases. Local development still uses `make api` and `make web`.

Store model keys in `/etc/commonplace/commonplace.env` on the server. Set `APP_ENV=prototype`, `STORAGE_PROVIDER=local`, and an absolute persistent `DATA_DIR=/var/lib/commonplace`. App sessions and optional SQLite-mode data live there; live object memory/evidence use SpacetimeDB when MEMORY_PROVIDER=spacetimedb; changing the code release does not reset it. No hosted object-storage account is required.

For saved users, follow [the existing public user-table instructions](USERS.md). The image stream and guest registry may point to the same hosted database but have independent adapters. The host needs network access, not your friend's personal CLI login.

## Meta Muse assistant and voice

1. Redeem the hackathon credit using the Meta booth's instructions and check its product/model eligibility and expiry in your Meta developer project.
2. Create a **Meta Model API** key and set `MODEL_API_KEY` in the backend `.env`.
3. Set `META_MODEL` to an enabled Muse Spark model, for example `muse-spark-1.3`, and leave `META_VOICE_MODEL=muse-voice-transcribe-1.0` unless your dashboard/docs specify another enabled model.
4. Follow [the Muse testing guide](MUSE_TESTING.md) for independent text, microphone, and read-aloud checks. No database, Gemini key, hosted server, domain, or consumer Muse account linking is required for that UI.
5. Later, enable `ASSISTANT_PROVIDER=muse` and use the full app to test a shared household report from another member.

Muse Voice Transcribe converts audio to text; browser speech synthesis reads the answer aloud. Tap **Talk to Muse** for automatic pause detection, sending, spoken replies, and follow-up listening; stop the session to type. Manual dictation remains available. Optional **Enable Hello** uses browser speech recognition while the page is visible, with explicit consent and a spoken acknowledgement. It may use the browser vendor’s remote recognition service and cannot run with the browser closed. See [accessible voice setup](ACCESSIBILITY.md). It is not an OS wake-word service or a continuous speech-to-speech API. Account access and browser voice behavior require live testing. The optional external search gateway is a separate experiment and is not needed for Model API chat.

## Team design and domain

Create one shared Figma file for the household, scan, result, and history screens. No Figma API token is needed for ordinary design collaboration. Share the GitHub repository through collaborator invitations.

Choose and register a domain through the hackathon's GoDaddy Registry offer after deployment works and you have checked the offer's eligibility. Vultr hosts the deployed app; Tiger Data and Convex are not required.

## Saved users and test reset

See [saved-user setup](USERS.md). By default, no database setup is needed for the selectable user list: add names and switch users during a run; restarting `make api` resets that temporary list and rejects its old sessions. Use `GUEST_PROFILE_STORE=sqlite` for persistence between local runs, or configure the independent SpacetimeDB profile registry. Image/object memory is a separate store and is not erased by resetting temporary users.
