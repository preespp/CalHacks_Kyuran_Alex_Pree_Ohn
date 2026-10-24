# Azure deployment and GoDaddy domain guide

Reviewed against the linked official documentation on October 24, 2026. The app now supports name-only guest entry and an explicit prototype environment. Container packaging/static serving and retained cloud memory still need implementation; this is a deployment runbook, not an already working deployment script. No cloud resources, domain registrations, or DNS changes were made while writing it.

Use **GoDaddy for the domain and DNS**, and **Azure Container Apps for the finished React + FastAPI app**. Azure for Students is the subscription that pays for Azure resources; select it when creating each resource. Meta, Gemini, and any separately hosted SpacetimeDB service retain their own billing. There is no user subscription/payment flow in this app. An Azure subscription is the required hosting/billing account, not a subscription your app users need.

The order is: activate the student subscription → reserve a domain → finish the release prerequisites → build and deploy → test Azure's HTTPS address → connect GoDaddy DNS → test the custom HTTPS address. You can reserve the domain before development is finished; DNS needs the deployed app's actual hostname.

## 0. Activate Azure for Students

1. Open [Azure for Students](https://azure.microsoft.com/en-us/free/students/) and select **Start free**. Sign in with the Microsoft account you want to use for this project, then complete academic verification using your school email.
2. The current offer includes **$100 credit for 12 months**, with no credit card required, subject to eligibility. In [Azure portal](https://portal.azure.com), open **Subscriptions** and confirm **Azure for Students** is active. Use the actual subscription ID from that page in the CLI commands below. The limited **Students Starter** offer is a different offer; verify the credit-bearing subscription is the one selected.
3. Check remaining credit and expiry in your subscription's available credit/billing view. Create budget email alerts in Cost Management where your subscription supports them; alerts are notifications, not a spending stop. Keep the subscription's spending protection in place and do not switch to paid billing just to follow a tutorial. [Cost alert documentation](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/cost-mgt-alerts-monitor-usage-spending).
4. Choose a region permitted by this subscription with Container Apps capacity. Student subscriptions can have region/quota restrictions; if validation rejects a region, check the exact error and available locations before provisioning the remaining resources there.
5. Use a **Consumption** workload profile for this small first deployment. Its monthly free grant can reduce compute/request charges, but storage, registry, logs, and other services have separate usage rules. Set a small maximum replica count; scale to zero outside active use if cold starts are acceptable. For certificate validation/renewal and the live demo, keep the app running as required by Azure's certificate instructions. [Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing).

Install Docker Desktop and the Azure CLI on your development machine before the release build. Run Docker locally; Azure Cloud Shell is not the local Docker build environment described here. On macOS, Azure CLI can be installed with `brew install azure-cli` if Homebrew is already installed. Verify `docker version` and `az version` before continuing.

**Student-credit build restriction:** Microsoft's [ACR Tasks overview](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-tasks-overview) currently says task runs funded by Azure free credits are paused. Consequently, `az acr build` can fail with `TasksOperationsNotAllowed`. This guide builds locally with Docker and pushes the finished image to ACR, following [Microsoft's Docker push instructions](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-get-started-docker-cli). This avoids depending on a cloud build task; it does not make registry storage free.

## 1. Finish the prototype deployment package

The prototype deliberately uses **name-only guest entry**, not account registration. No password, email provider, paid user subscription, OAuth setup, or login callback is needed. Everyone who joins can read and update one shared demo household. Display names are unverified labels, so use demo content. Verified private-household accounts can remain a future feature.

| Current state                                              | Prototype deployment requirement                                                                                        | How to verify                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Name-only guest entry is implemented                       | Keep the guest entry screen and short shared-demo notice                                                                | Join with any name, switch guest, and leave; the prior token becomes invalid                  |
| Local and prototype environments are supported             | Use `APP_ENV=prototype` on Azure                                                                                        | Health reports `auth_mode: guest`; fixed-profile `/api/demo/session` is unavailable           |
| API uses SQLite                                            | Finish SpacetimeDB integration for retained shared cloud memory, or explicitly run a disposable one-replica SQLite demo | A retained-memory deployment survives restart; a disposable demo must not promise persistence |
| Images can use local files or Azure Blob Storage           | Use private Blob Storage for retained photos; local files are disposable in a container                                 | Retrieve evidence through the guest-session API, not an anonymous public blob URL             |
| `/api` forwarding exists only in Vite's development server | Serve built React assets and FastAPI under the same public origin                                                       | The packaged app serves `/`, `/camera`, assets, and `/api/...` without Vite                   |
| Container packaging is unfinished                          | Add a root Dockerfile, `.dockerignore`, and runtime dependency setup                                                    | Run the release container locally and exercise the real browser flow                          |

`APP_ENV=production` remains reserved for a future verified-account implementation. It is not required for this prototype; use the supported `prototype` mode instead. The separate Muse lab stays local/development-only.

Merely setting `SPACETIMEDB_URL` does not replace `Store(...)` in `main.py`. For a disposable demo, keep SQLite on **one replica** and expect guest sessions, metadata, and local images to disappear when that container's ephemeral storage is replaced. For retained cloud state, finish the database adapter and persist sessions as well as object rows. See [Container Apps storage behavior](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts).

Test real Gemini room scanning locally before the cloud deployment; follow [the scan acceptance guide](LIVE_SCAN.md). Use several distinctive objects, verify box placement after image rotation, and exercise quota/error responses. Set per-member upload limits for the public endpoint. Enable sample seeding only in an intentional demo environment.

The live camera now captures every 3–5 seconds (default 5 seconds) and uses a bounded in-process analysis worker; durable distributed jobs, embeddings, on-device inference, and SLAM remain later milestones. Use one API process/replica for this prototype's temporary stream state. See [the assistance lifecycle](ASSISTANCE_SESSION.md). Test the in-app Muse assistant using [the two-person runbook](MUSE_TESTING.md), including fresh updates, unknown/ambiguous matches, and quota failures. Add per-member chat rate/concurrency limits and project spending controls before public access. No consumer Muse connector is required. Deploy the session-scoped household app in prototype mode. Ask Muse includes chat and voice; the separate test page, menu link, and sandbox backend have been retired. See [accessible voice testing](ACCESSIBILITY.md) for the current **Hello** activation flow and device checks.

## 2. Use one public app origin for the first release

Recommended layout:

```text
app.yourdomain.com
    Azure Container App
        built React frontend at /
        FastAPI routes at /api
        name-only guest entry + session-scoped API
    ├── Meta Model API (Muse chat and transcription)
    ├── Gemini API (vision)
    ├── SpacetimeDB shared state once integrated (or disposable single-replica SQLite)
    └── private Azure Blob Storage
```

This preserves the frontend's relative `/api` calls. Build React once with `npm run build` and serve the resulting `apps/web/dist` in the production container. A static-file route or SPA fallback must not swallow API routes or return HTML for missing `/api` endpoints.

Run Uvicorn inside the container on `0.0.0.0:8080`, without `--reload`. Keep the runtime image small: compiled frontend assets, Python application/runtime dependencies including the Azure extra, and required application assets. Install the API dependencies including headless OpenCV/NumPy; its wheel bundles the reusable `camera_capture` quality module. A source-based container must include that module too. Resolve resource paths inside the container rather than depending on the developer checkout layout.

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

After implementing the Dockerfile and selecting the retained/disposable state setup, test the release artifact:

```bash
docker build --platform linux/amd64 -t commonplace:release .
docker run --rm -p 127.0.0.1:8080:8080 --env-file .env.prototype commonplace:release
```

`.env.prototype` is a local, ignored file for this validation, not something copied into the image. Set `APP_ENV=prototype` and the tested model/storage settings there. The repository still needs the Dockerfile and frontend static serving before this command can work.

Test the app at `http://localhost:8080`: enter a guest name, start a live room scan, search from another session, move a distinctive object while scanning, and retrieve its updated last-seen evidence. Verify stopping/visibility handling, bounded requests, and no contributor attribution. For retained state, stop/restart the container and verify the records and guest session survive. For a disposable demo, verify and explain its reset behavior. Add an equivalent smoke check against the built release; the existing browser tests run development servers.

Commit the tested release so its Git SHA can identify the deployed image. Existing work in this repository is still local until you commit and push it.

## 4. Prepare Azure resources

Use one resource group and a consistent region where your subscription has capacity. Check hackathon credits and subscription access first.

Create these resources in the Azure portal:

| Resource                                              | Purpose                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| Resource group, e.g. `commonplace-prod-rg`            | Group this release's Azure resources                                       |
| Container Registry                                    | Store versioned application images; check the SKU's price/free entitlement |
| Container Apps environment with Consumption profile   | Run the public application                                                 |
| Storage account with private `scene-images` container | Store photographs                                                          |
| User-assigned managed identity                        | Authorize image pulls and blob access                                      |
| Container App                                         | Run the finished application image                                         |

Give the runtime identity **Storage Blob Data Contributor** access at the intended blob/container scope. Configure private registry pulls with managed identity. For a registry using classic registry RBAC, the pull role is **AcrPull**; an ABAC-enabled registry uses repository roles instead. Follow [Microsoft's image-pull setup](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull) and [registry role reference](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-built-in-roles-directory-reference).

Attach the identity to the app and set `AZURE_CLIENT_ID` to that user-assigned identity's client ID so `DefaultAzureCredential` selects it. See [managed identities](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity).

SpacetimeDB is provisioned/deployed separately; publishing its module, connecting the API adapter, and mapping guest/service identities are prerequisites if you choose retained SpacetimeDB memory. It is not enabled by the environment variables alone.

## 5. Build an immutable image and launch the Container App

Install the Azure CLI and authenticate:

```bash
az login
az account set --subscription "YOUR_SUBSCRIPTION_ID"
az extension add --name containerapp --upgrade
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
```

After the registry exists and the Dockerfile is complete, build on your development machine from the repository root. Replace the example resource names with your own. Your signed-in Azure identity needs permission to push to that registry, separate from the runtime identity's pull access:

```bash
CP_RG="commonplace-prod-rg"
CP_APP="commonplace-web"
CP_ACR="YOUR_GLOBALLY_UNIQUE_REGISTRY_NAME"
CP_TAG="$(git rev-parse --short HEAD)"

CP_REGISTRY_HOST="$(az acr show --name "$CP_ACR" --query loginServer --output tsv)"

az acr login --name "$CP_ACR"

docker build \
  --platform linux/amd64 \
  --tag "$CP_REGISTRY_HOST/commonplace:$CP_TAG" \
  .

docker push "$CP_REGISTRY_HOST/commonplace:$CP_TAG"
```

The Docker build runs locally; pushing stores the image in Azure and can incur registry charges. Do not use the raw repository directory or `npm run dev` as the hosted production runtime. See [Azure Container Registry CLI](https://learn.microsoft.com/en-us/cli/azure/acr?view=azure-cli-latest).

In the Azure portal, search **Container Apps → Create → Container App**. Choose the student subscription, resource group, allowed region, and Consumption environment. Select **Container image** as the deployment source and use the registry image/tag above, rather than the quickstart sample image. Configure the settings below before routing public traffic. [Portal walkthrough](https://learn.microsoft.com/en-us/azure/container-apps/quickstart-portal).

- Attach the managed identity and select it for private registry authentication.
- Enable external HTTP ingress; target port **8080**, with HTTPS enforced.
- Add the Meta Model API key, Gemini vision key, and any final SpacetimeDB/service credentials under **Secrets**. Reference them from environment variables. Keep credentials out of shell command arguments, image layers, frontend configuration, and Git.
- Set the ordinary environment variables below, plus the SpacetimeDB settings if that adapter has been integrated. Guest mode needs no external login-provider settings. Set `GUEST_PROFILE_STORE=spacetimedb` for retained selectable users, with `SPACETIMEDB_PROFILE_ACCESS=public` for the published public guest table or separate users-only registry. An older private registry uses `private` with a backend-only owner token; see [saved-user setup](USERS.md). Profiles alone do not migrate object memory or session hashes. Temporary `local` profiles require a single backend process and reset on restart.
- Start with a small CPU/memory allocation and a bounded replica count. Keeping one replica warm during certificate issuance and the hackathon demo avoids a cold-start surprise; it also has a running cost.
- Configure startup/liveness and readiness probes. `/api/health` currently reports process configuration, not dependency readiness; add a separate readiness check for required remote state. Do not make paid model calls on every probe.

| Environment variable             | Release value                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GUEST_PROFILE_STORE`            | `local` for disposable tests, `sqlite` for local persistence, or `spacetimedb` for the profile registry     |
| `SPACETIMEDB_PROFILE_ACCESS`     | `public` for a public guest table/users-only registry, or `private` (default) for an older private registry |
| `SPACETIMEDB_SERVER_TOKEN`       | Backend-only app secret; database-owner token for private profile reads                                     |
| `APP_ENV`                        | `prototype` for this name-only shared demo                                                                  |
| `VISION_PROVIDER`                | `gemini`                                                                                                    |
| `MODEL_API_KEY`                  | Reference to the Meta Model API app secret                                                                  |
| `META_MODEL`, `META_VOICE_MODEL` | Tested Muse chat/transcription model IDs                                                                    |
| `GEMINI_CHAT_API_KEY`            | Optional previous Gemini adapter secret                                                                     |
| `GEMINI_VISION_API_KEY`          | Reference to the vision team's app secret                                                                   |
| `GEMINI_MODEL`                   | Tested model ID available to your project                                                                   |
| `ASSISTANT_PROVIDER`             | `muse` after live assistant verification                                                                    |
| `GEMINI_CHAT_MODEL`              | Optional previous Gemini adapter model ID                                                                   |
| `STORAGE_PROVIDER`               | `azure`                                                                                                     |
| `AZURE_STORAGE_ACCOUNT_URL`      | Your storage account URL                                                                                    |
| `AZURE_STORAGE_CONTAINER`        | `scene-images`                                                                                              |
| `AZURE_CLIENT_ID`                | The attached user-assigned identity's client ID                                                             |

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

Open that HTTPS URL on the actual iPhone. Guest entry needs no external identity provider or login callback.

Verify name-only guest entry, camera permission, image analysis, photo retrieval, a second guest's access, and a movement report. Verify the selected state-retention behavior after restart. A request without a guest token must fail, while any visitor can intentionally join the shared demo by entering a name; this is not a private household boundary. Check logs for image-pull, credentials, startup, and model quota errors.

The current `/api/health` reports `memory_provider: sqlite` and `auth_mode: guest`. Update the memory status only when the remote adapter is actually integrated. Do not describe guest names as verified identities.

## 7. Register the domain and connect it

You can reserve a chosen name while development continues. Check the hackathon's official GoDaddy Registry offer, eligible extensions, renewal terms, and redemption instructions first. Domain ownership/DNS lives with the registrar; the application and TLS certificate live on Azure.

### Register the domain

1. Create/sign in to the GoDaddy account the team will retain access to, and open [GoDaddy domain search](https://www.godaddy.com/domains).
2. Search for your preferred available name. `yourdomain.com` in this guide is a placeholder; it does not imply a particular name is available. If the hackathon provides a redemption link/code, use that offer's instructions before checking out.
3. Review the registration term, total checkout price, renewal price, and auto-renewal setting. A promotional first-year price or hackathon offer does not establish the renewal price. You only need domain registration/DNS for this architecture; hosting runs on Azure and a qualifying managed certificate comes from Azure.
4. Complete registration and any required contact-email verification. Confirm the domain appears in **Domain Portfolio**. Use the account's security settings to enable two-step verification.
5. Plan the first app address as **`app.yourdomain.com`**. This subdomain is a DNS entry under the domain you registered, not a second domain purchase. Keep the default authoritative nameservers if using GoDaddy's DNS editor; no transfer to Azure DNS is needed for this plan.

### Connect the deployed app

For the first custom hostname, use `app.yourdomain.com`. In Azure, open the Container App's **Custom domains** page and add it. Copy the generated hostname and domain verification ID exactly as shown.

At GoDaddy, open **Domain Portfolio → your domain → DNS → Add New Record**. If your authoritative nameservers are hosted elsewhere, edit the records at that DNS provider instead. Add the exact values Azure displays:

| Type  | Name        | Value                                                      |
| ----- | ----------- | ---------------------------------------------------------- |
| CNAME | `app`       | Generated Azure app hostname, without `https://` or a path |
| TXT   | `asuid.app` | Azure's domain verification value                          |

Then validate the hostname in Azure and select a managed certificate. Keep the CNAME pointed directly to the generated app hostname for certificate issuance/renewal. For the root domain instead, Azure supplies an environment IP for an `A` record at `@` and verification TXT at `asuid`. See [Azure domain/certificate instructions](https://learn.microsoft.com/en-us/azure/container-apps/custom-domains-managed-certificates).

Do not put `localhost`, a port number, `https://`, or a path in the CNAME target. If an existing `app` record conflicts, update that hostname's record; leave unrelated email and other DNS records intact. Keep the app running while Azure issues the certificate, and check Azure's documented CAA/DigiCert requirements if the domain already has CAA records. [GoDaddy TXT instructions](https://www.godaddy.com/help/add-a-txt-record-19232).

GoDaddy documents the DNS editor in [its CNAME guide](https://www.godaddy.com/help/add-a-cname-record-19236). Changes can take up to 48 hours globally, so leave time before judging.

Check propagation locally:

```bash
dig +short CNAME app.yourdomain.com
dig +short TXT asuid.app.yourdomain.com
```

When Azure shows the hostname as **Secured**, open `https://app.yourdomain.com` and repeat guest entry, camera, two-guest shared memory, Ask Muse, microphone, spoken replies, and default-enabled Hello activation and manual recovery tests on the actual phone. Confirm permissions and fallback controls work on that HTTPS origin; microphone permissions granted to localhost do not establish permission for the domain. Update any origin allowlist used by the finished app. No OAuth callback is needed for the name-only guest flow. Keep API keys in Azure secrets. For profiles, follow [saved-user setup](USERS.md): the public guest table and updated users-only registry require no runtime owner token, while an older private registry keeps its token in Azure secrets. Publishing uses your own/team account; the Azure runtime needs no SpacetimeDB CLI. The assistant uses the same-origin `/api/chat` route and needs no external connector URL. Configure both root and `www` separately if you later want those hostnames too.

## 8. Release future changes and keep a rollback

For each release: pass checks, commit, build a new SHA-tagged image, and update the Container App:

```bash
CP_TAG="$(git rev-parse --short HEAD)"

az acr login --name "$CP_ACR"

docker build \
  --platform linux/amd64 \
  --tag "$CP_REGISTRY_HOST/commonplace:$CP_TAG" \
  .

docker push "$CP_REGISTRY_HOST/commonplace:$CP_TAG"

az containerapp update \
  --name "$CP_APP" \
  --resource-group "$CP_RG" \
  --image "$CP_REGISTRY_HOST/commonplace:$CP_TAG"
```

For the first release, a single active revision is simplest. For controlled releases, use multiple revisions and direct traffic to the previous healthy revision if the new one fails the smoke test. Image rollback does not roll back shared database schema or data; keep schema changes compatible with the retained release and maintain a recovery plan. See [revision management](https://learn.microsoft.com/en-us/azure/container-apps/revisions).

Later, add a dedicated GitHub Actions deploy workflow using Azure federation/OIDC, scoped deployment permissions, and a production environment. The existing `.github/workflows/checks.yml` only runs checks; it does not deploy. Microsoft's [Container Apps GitHub Actions guide](https://learn.microsoft.com/en-us/azure/container-apps/github-actions) describes the integration.

Record the deployed image tag, module version, Azure hostname, custom hostname, and tested demo flow in the release notes. Leave a budget alert and inspect usage after the event.
