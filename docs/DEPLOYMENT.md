# Azure deployment and GoDaddy domain guide

Reviewed against the linked official documentation on October 23, 2026. This is a future deployment runbook, not a deployment script that works against the unfinished starter today. No cloud resources, domain registrations, or DNS changes were made while writing it.

## 1. Finish these changes before a public release

| Current state                                              | Required release behavior                                                                        | How to verify                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Anyone can choose a demo profile                           | Real sign-in; API verifies identity and household membership; public demo-session route disabled | A signed-out user cannot read images or memory; another household cannot access yours          |
| Startup permits only development mode                      | Explicit production configuration backed by the real authentication implementation               | Start the packaged app with `APP_ENV=production`; do not bypass the current guard              |
| API persists to local SQLite                               | Complete the SpacetimeDB integration for shared application state and real identity mapping      | Save an item, replace the app revision, and retrieve the same observation from another session |
| Photographs default to local files                         | Private Azure Blob Storage using managed identity                                                | A member can read their image; an unauthenticated request cannot                               |
| `/api` forwarding exists only in Vite's development server | Built React assets and API served under the same public origin                                   | The packaged app serves `/`, assets, and `/api/...` without Vite                               |
| No container packaging                                     | Root Dockerfile, `.dockerignore`, production runtime dependency setup                            | Run the release container locally and exercise the actual browser flow                         |

There is no production database switch today: merely setting `SPACETIMEDB_URL` does not change `Store(...)` in `main.py`. Integrate the module and replace the SQLite-backed application state before relying on cloud persistence. Authentication/session storage must also be addressed, not just object rows.

Container-local files disappear when the container stops or restarts, so `.data/memory.sqlite3` is not durable cloud storage by itself. See [Container Apps storage behavior](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts).

Test real Gemini capture locally before the cloud deployment. Use several distinctive objects, verify box placement after image rotation, and exercise quota/error responses. Set per-member upload limits for the public endpoint. Enable sample seeding only in an intentional demo environment.

The background worker, embeddings, on-device inference, and SLAM can remain later milestones if deliberate captures meet the demo's needs. Complete and test the Muse account connection before demonstrating it as a working integration.

## 2. Use one public app origin for the first release

Recommended layout:

```text
app.yourdomain.com
    Azure Container App
        built React frontend at /
        FastAPI routes at /api
        production sign-in and authorization
    ├── Gemini API
    ├── SpacetimeDB shared state
    └── private Azure Blob Storage
```

This preserves the frontend's relative `/api` calls. Build React once with `npm run build` and serve the resulting `apps/web/dist` in the production container. A static-file route or SPA fallback must not swallow API routes or return HTML for missing `/api` endpoints.

Run Uvicorn inside the container on `0.0.0.0:8080`, without `--reload`. Keep the runtime image small: compiled frontend assets, Python application/runtime dependencies including the Azure extra, and required application assets. Resolve resource paths inside the container rather than depending on the developer checkout layout.

The future `.dockerignore` must exclude `.env*`, `.data`, `.venv`, `node_modules`, `.git`, credentials, and test output. Build from the repository root so the intended source paths are available. Build the initial Azure image for `linux/amd64` to avoid accidentally publishing a Mac-specific image.

## 3. Validate the finished release locally

Run the existing checks:

```bash
npm ci
npm run check
npm run test:module
make test
npx playwright install chromium
npm run test:browser
```

After implementing the Dockerfile and production configuration, test the release artifact:

```bash
docker build --platform linux/amd64 -t commonplace:release .
docker run --rm -p 127.0.0.1:8080:8080 --env-file .env.production commonplace:release
```

`.env.production` is a local, ignored file for this validation, not something copied into the image. It must use the final real-auth and remote-state configuration. The current starter intentionally cannot pass this production-start step yet.

Test the app at `http://localhost:8080`: sign in, capture a real image, search from another session, report a movement, and retrieve the earlier evidence. Stop/restart the container and verify the cloud state survives. Add an equivalent smoke check against the built release; the existing browser tests run development servers.

Commit the tested release so its Git SHA can identify the deployed image. Existing work in this repository is still local until you commit and push it.

## 4. Prepare Azure resources

Use one resource group and a consistent region where your subscription has capacity. Check hackathon credits and subscription access first.

Create these resources in the Azure portal:

| Resource                                              | Purpose                               |
| ----------------------------------------------------- | ------------------------------------- |
| Resource group, e.g. `commonplace-prod-rg`            | Group this release's Azure resources  |
| Container Registry                                    | Store versioned application images    |
| Container Apps environment                            | Run the public application            |
| Storage account with private `scene-images` container | Store photographs                     |
| User-assigned managed identity                        | Authorize image pulls and blob access |
| Container App                                         | Run the finished application image    |

Give the runtime identity **Storage Blob Data Contributor** access at the intended blob/container scope. Configure private registry pulls with managed identity. For a registry using classic registry RBAC, the pull role is **AcrPull**; an ABAC-enabled registry uses repository roles instead. Follow [Microsoft's image-pull setup](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull) and [registry role reference](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-built-in-roles-directory-reference).

Attach the identity to the app and set `AZURE_CLIENT_ID` to that user-assigned identity's client ID so `DefaultAzureCredential` selects it. See [managed identities](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity).

SpacetimeDB is provisioned/deployed separately; publishing its module and configuring the final authentication/service identity are prerequisites to the app's persistence checks.

## 5. Build an immutable image and launch the Container App

Install the Azure CLI and authenticate:

```bash
az login
az account set --subscription "YOUR_SUBSCRIPTION_ID"
az extension add --name containerapp --upgrade
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
```

After the registry exists and the Dockerfile is complete, build in Azure from the repository root. Replace the example resource names with your own:

```bash
CP_RG="commonplace-prod-rg"
CP_APP="commonplace-web"
CP_ACR="YOUR_GLOBALLY_UNIQUE_REGISTRY_NAME"
CP_TAG="$(git rev-parse --short HEAD)"

az acr build \
  --registry "$CP_ACR" \
  --image "commonplace:$CP_TAG" \
  --platform linux/amd64 \
  .

CP_REGISTRY_HOST="$(az acr show --name "$CP_ACR" --query loginServer --output tsv)"
```

These commands create a cloud build and consume resources when you execute them. See [Azure Container Registry CLI](https://learn.microsoft.com/en-us/cli/azure/acr?view=azure-cli-latest).

In the Azure portal, create the Container App using that registry image and tag:

- Attach the managed identity and select it for private registry authentication.
- Enable external HTTP ingress; target port **8080**, with HTTPS enforced.
- Add the Gemini key and any final SpacetimeDB/service credentials under **Secrets**. Reference them from environment variables. Keep credentials out of shell command arguments, image layers, frontend configuration, and Git.
- Set the ordinary environment variables below, plus the real-auth/SpacetimeDB settings defined by the finished integration.
- Start with a small CPU/memory allocation and a bounded replica count. Keeping one replica warm during certificate issuance and the hackathon demo avoids a cold-start surprise; it also has a running cost.
- Configure startup/liveness and readiness probes. `/api/health` currently reports process configuration, not dependency readiness; add a separate readiness check for required remote state. Do not make paid Gemini calls on every probe.

| Environment variable        | Release value                                   |
| --------------------------- | ----------------------------------------------- |
| `APP_ENV`                   | `production`, once implemented and tested       |
| `VISION_PROVIDER`           | `gemini`                                        |
| `GEMINI_API_KEY`            | Reference to the app secret                     |
| `GEMINI_MODEL`              | Tested model ID available to your project       |
| `STORAGE_PROVIDER`          | `azure`                                         |
| `AZURE_STORAGE_ACCOUNT_URL` | Your storage account URL                        |
| `AZURE_STORAGE_CONTAINER`   | `scene-images`                                  |
| `AZURE_CLIENT_ID`           | The attached user-assigned identity's client ID |

See [Container Apps deployment](https://learn.microsoft.com/en-us/azure/container-apps/quickstart-code-to-cloud) and [health probes](https://learn.microsoft.com/en-us/azure/container-apps/health-probes).

## 6. Prove the Azure hostname works before changing DNS

Get the application's generated hostname:

```bash
az containerapp show \
  --name "$CP_APP" \
  --resource-group "$CP_RG" \
  --query properties.configuration.ingress.fqdn \
  --output tsv
```

Open that HTTPS URL on the actual iPhone. Configure its exact login callback/origin in your chosen identity provider for this stage.

Verify sign-in, camera permission, image analysis, photo retrieval, a second user's access, and a movement report. Replace/restart a revision and verify observations still exist. Confirm private household data remains inaccessible without authorization. Check logs for image-pull, credentials, startup, and model quota errors.

The existing `/api/health` reports `sqlite` and `demo`; it must reflect the actual completed production implementation before release.

## 7. Register the domain and connect it

You can reserve a chosen name while development continues. Check the hackathon's official GoDaddy Registry offer, eligible extensions, renewal terms, and redemption instructions first. Domain ownership/DNS lives with the registrar; the application and TLS certificate live on Azure.

For the first custom hostname, use `app.yourdomain.com`. In Azure, open the Container App's **Custom domains** page and add it. Copy the generated hostname and domain verification ID exactly as shown.

At GoDaddy, open **Domain Portfolio → your domain → DNS → Add New Record**. If your authoritative nameservers are hosted elsewhere, edit the records at that DNS provider instead. Add:

| Type  | Name        | Value                                                      |
| ----- | ----------- | ---------------------------------------------------------- |
| CNAME | `app`       | Generated Azure app hostname, without `https://` or a path |
| TXT   | `asuid.app` | Azure's domain verification value                          |

Then validate the hostname in Azure and select a managed certificate. Keep the CNAME pointed directly to the generated app hostname for certificate issuance/renewal. For the root domain instead, Azure supplies an environment IP for an `A` record at `@` and verification TXT at `asuid`. See [Azure domain/certificate instructions](https://learn.microsoft.com/en-us/azure/container-apps/custom-domains-managed-certificates).

GoDaddy documents the DNS editor in [its CNAME guide](https://www.godaddy.com/help/add-a-cname-record-19236). Changes can take up to 48 hours globally, so leave time before judging.

Check propagation locally:

```bash
dig +short CNAME app.yourdomain.com
dig +short TXT asuid.app.yourdomain.com
```

When Azure shows the hostname as secured, open the custom HTTPS URL and repeat the phone test. Add the exact new callback/origin to the sign-in provider and update Muse's connector URL to the custom `/api/connector/search` endpoint. Configure both root and `www` separately if you later want those hostnames too.

## 8. Release future changes and keep a rollback

For each release: pass checks, commit, build a new SHA-tagged image, and update the Container App:

```bash
CP_TAG="$(git rev-parse --short HEAD)"

az acr build \
  --registry "$CP_ACR" \
  --image "commonplace:$CP_TAG" \
  --platform linux/amd64 \
  .

az containerapp update \
  --name "$CP_APP" \
  --resource-group "$CP_RG" \
  --image "$CP_REGISTRY_HOST/commonplace:$CP_TAG"
```

For the first release, a single active revision is simplest. For controlled releases, use multiple revisions and direct traffic to the previous healthy revision if the new one fails the smoke test. Image rollback does not roll back shared database schema or data; keep schema changes compatible with the retained release and maintain a recovery plan. See [revision management](https://learn.microsoft.com/en-us/azure/container-apps/revisions).

Later, add a dedicated GitHub Actions deploy workflow using Azure federation/OIDC, scoped deployment permissions, and a production environment. The existing `.github/workflows/checks.yml` only runs checks; it does not deploy. Microsoft's [Container Apps GitHub Actions guide](https://learn.microsoft.com/en-us/azure/container-apps/github-actions) describes the integration.

Record the deployed image tag, module version, Azure hostname, custom hostname, and tested demo flow in the release notes. Leave a budget alert and inspect usage after the event.
