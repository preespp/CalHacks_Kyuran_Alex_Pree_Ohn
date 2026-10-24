# Accounts and cloud setup

Start in sample mode using the root README. Create service accounts in parallel with the first local development milestone; credentials are not required to browse the sample household.

## Local tools

Use Node 24 from `.nvmrc`, Python 3.12, npm, and Git. Homebrew is optional. The root `Makefile` uses a project-local `.venv` and does not modify Anaconda.

Optional tools for later integration:

```bash
brew install uv azure-cli
```

Install SpacetimeDB with its [official installer](https://spacetimedb.com/install), then run `spacetime login` when publishing requires developer authentication.

## Gemini

1. Sign in to [Google AI Studio](https://aistudio.google.com/).
2. Create/select a project and create an API key.
3. Check the models and quotas available to that project.
4. Test one real demo photo using an image-capable model with structured-output support.
5. For computer vision, set `VISION_PROVIDER=gemini`, `GEMINI_VISION_API_KEY`, and `GEMINI_MODEL` in the root `.env`, then restart the API.

The user-facing assistant now uses **Meta Muse**, with separate `MODEL_API_KEY` / `META_MODEL` settings. Gemini vision does not use that key. To work on the assistant without the database or vision team, follow [Muse UI setup](MUSE_TESTING.md) and run `make muse-api` + `make muse-web` at `/muse`. All secrets stay in the repository-root `.env`, never `VITE_*` or frontend source. The old Gemini assistant and standalone script remain optional compatibility experiments; they are not part of the Muse flow.

The API uses the official REST `generateContent` endpoint. Account availability, rate limits, and supported models can change; choose the model from your own project rather than copying a guessed model ID. See [API key setup](https://ai.google.dev/gemini-api/docs/api-key) and [image understanding](https://ai.google.dev/gemini-api/docs/image-understanding).

## Microsoft Azure

Check the hackathon booth's credit instructions before activating an offer. Eligible students can start with [Azure for Students](https://azure.microsoft.com/en-us/free/students/).

1. Activate a subscription in the [Azure portal](https://portal.azure.com/).
2. Create a resource group for this project and choose a region.
3. Create a Storage account and a **private** Blob container named `scene-images`.
4. Grant your development identity **Storage Blob Data Contributor** access at the appropriate storage/container scope. Being able to manage the storage account does not automatically grant blob data access. Role changes can take time to propagate.
5. Install the Azure extra and authenticate:

```bash
.venv/bin/python -m pip install -e './services/api[azure]'
az login
az account show --output table
```

6. Configure `.env`:

```dotenv
STORAGE_PROVIDER=azure
AZURE_STORAGE_ACCOUNT_URL=https://YOUR_ACCOUNT.blob.core.windows.net
AZURE_STORAGE_CONTAINER=scene-images
```

7. Restart the API, enable Gemini vision, and use **Scan room → Start scanning** to save camera frames automatically every 3–5 seconds. The API reads images on behalf of the authenticated member; the browser receives neither a storage key nor public blob access.

The container must already exist. Sample illustrations remain repository assets. Keep the same storage provider for existing captures until a migration tool exists. Azure adapters have not been exercised against your account by the scaffold's mock/local tests.

For a future Container Apps deployment, use managed identity for blob access, attach durable storage or complete the SpacetimeDB migration, set `APP_ENV=prototype` for the name-only shared demo, and set backend secrets through the deployment platform. No external login provider is required for this prototype. The `production` environment remains reserved for future verified private accounts.

## Meta Muse assistant and voice

1. Redeem the hackathon credit using the Meta booth's instructions and check its product/model eligibility and expiry in your Meta developer project.
2. Create a **Meta Model API** key and set `MODEL_API_KEY` in the backend `.env`.
3. Set `META_MODEL` to an enabled Muse Spark model, for example `muse-spark-1.3`, and leave `META_VOICE_MODEL=muse-voice-transcribe-1.0` unless your dashboard/docs specify another enabled model.
4. Follow [the Muse testing guide](MUSE_TESTING.md) for independent text, microphone, and read-aloud checks. No database, Gemini key, Azure, domain, or consumer Muse account linking is required for that UI.
5. Later, enable `ASSISTANT_PROVIDER=muse` and use the full app to test a shared household report from another member.

Muse Voice Transcribe converts audio to text; browser speech synthesis reads the answer aloud. Tap **Talk to Muse** for automatic pause detection, sending, spoken replies, and follow-up listening; stop the session to type. Manual dictation remains available. Optional **Enable Hello** uses browser speech recognition while the page is visible, with explicit consent and a spoken acknowledgement. It may use the browser vendor’s remote recognition service and cannot run with the browser closed. See [accessible voice setup](ACCESSIBILITY.md). It is not an OS wake-word service or a continuous speech-to-speech API. Account access and browser voice behavior require live testing. The optional external search gateway is a separate experiment and is not needed for Model API chat.

## Team design and domain

Create one shared Figma file for the household, scan, result, and history screens. No Figma API token is needed for ordinary design collaboration. Share the GitHub repository through collaborator invitations.

Choose and register a domain through the hackathon's GoDaddy Registry offer after deployment works and you have checked the offer's eligibility. Tiger Data, Convex, and Vultr are optional later choices, not requirements for running this repository.

## Saved users and test reset

See [saved-user setup](USERS.md). By default, no database setup is needed for the selectable user list: add names and switch users during a run; restarting `make api` resets that temporary list and rejects its old sessions. Use `GUEST_PROFILE_STORE=sqlite` for persistence between local runs, or configure the independent SpacetimeDB profile registry. Image/object memory is a separate store and is not erased by resetting temporary users.
