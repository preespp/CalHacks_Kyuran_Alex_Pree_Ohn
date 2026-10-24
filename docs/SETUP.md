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
5. Set `VISION_PROVIDER=gemini`, `GEMINI_API_KEY`, and `GEMINI_MODEL` in the root `.env`, then restart the API.

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

7. Restart the API and capture a real photograph with Gemini enabled. The API reads images on behalf of the authenticated member; the browser receives neither a storage key nor public blob access.

The container must already exist. Sample illustrations remain repository assets. Keep the same storage provider for existing captures until a migration tool exists. Azure adapters have not been exercised against your account by the scaffold's mock/local tests.

For a future Container Apps deployment, use managed identity for blob access, attach durable storage or complete the SpacetimeDB migration, replace demo authentication, and set backend secrets through the deployment platform. The current startup guard deliberately rejects production mode with demo identities.

## Muse connector

1. Sign in to [Muse](https://muse.ai/).
2. Confirm with the Meta booth how your hackathon account can attach a custom authenticated API or MCP service.
3. Make the development API reachable through HTTPS after confirming the demo-data access boundary.
4. Describe the `search_household_memory` operation using the API's `/openapi.json` schema.
5. Connect it to `GET /api/connector/search?q=...` with a bearer credential authorized for the intended household.
6. Test: “Where did we leave the HDMI adapter?” Verify that the answer includes source, time, and the distinction between member-reported and visually observed locations.

The starter endpoint is read-only. The local `/api/demo/session` response supplies a short-lived development bearer token; it is not a production connector credential or OAuth flow. Do not embed it in checked-in manifests, URLs, screenshots, or prompts. A production connector needs proper sign-in/delegation, revocation, and an account-scoped permission flow.

The repository does not automatically register a connector, impersonate Muse, or claim that directory approval has occurred. Follow [Meta's connector guidance](https://platform.muse.ai/docs) and the hackathon's account-specific instructions.

## Team design and domain

Create one shared Figma file for the household, scan, result, and history screens. No Figma API token is needed for ordinary design collaboration. Share the GitHub repository through collaborator invitations.

Choose and register a domain through the hackathon's GoDaddy Registry offer after deployment works and you have checked the offer's eligibility. Tiger Data, Convex, and Vultr are optional later choices, not requirements for running this repository.
