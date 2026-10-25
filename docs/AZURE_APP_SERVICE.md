# Azure App Service and GoDaddy

Host React and FastAPI together on a Linux Python 3.12 App Service. Docker on your Mac is not required. These files prepare a deployment; they do not create Azure resources, publish SpacetimeDB changes or upload code automatically.

This guide uses the earlier app name `remi` and resource group `remi-rg`. Replace them if your Azure Overview page shows different names. Copy the exact **Default domain** from that page; secure unique hostnames can contain a suffix.

## 1. Files provided

| File                                    | Purpose                                                                |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `app_service.py`                        | Serves built React pages and the existing authorized API.              |
| `requirements.txt`                      | Lets Azure install the tested Python dependencies and the API package. |
| `deploy/azure/package.py`               | Builds React, checks TypeScript and makes `remi-azure.zip`.            |
| `deploy/azure/appsettings.example.json` | Placeholder settings for the live SpacetimeDB/Muse/Gemini workflow.    |

The ZIP includes the API, connected worker, camera helpers and compiled frontend. It excludes local `.env` files, private settings, databases, model weights, virtual environments, node_modules and tests. It packages your current working files, including new frontend changes that have not been committed. Save tested changes in Git for reproducible releases.

## 2. Check locally and create the package

From the repository root, after installing the project's usual dependencies:

```bash
make test
npm run test:module
npm run test:browser
.venv/bin/python scripts/check_docs.py
.venv/bin/python deploy/azure/package.py
```

The packaging command runs `npm run check` before creating **`remi-azure.zip` in the repository root**. It makes no cloud or AI calls. `--skip-build` is available only when you have already checked and built the exact frontend you intend to deploy.

To preview the combined frontend/API locally, using your normal local configuration:

```bash
.venv/bin/python -m uvicorn app_service:app --host 127.0.0.1 --port 8002 --workers 1
```

Open <http://127.0.0.1:8002>. Stop this preview with Control+C before continuing. Existing `make api` and `make web` commands remain the development workflow.

## 3. Configure Azure before uploading

In Azure Portal → App Services → your application:

- Use **Publish: Code**, **Linux**, **Python 3.12**, and your existing Basic plan.
- Keep **one instance**. Camera jobs have process-local state.
- Enable **Always On** and **HTTPS Only**.
- Keep automatic **Application Insights** instrumentation disabled for this deployment: set `ApplicationInsightsAgent_EXTENSION_VERSION=disabled` under Environment variables. Its bundled Python dependencies caused a confirmed startup conflict with this app. App Service runtime logs remain available; automatic Application Insights telemetry is disabled.
- Under Settings → Configuration → General settings, enter this **Startup Command**:

```text
python -m uvicorn app_service:app --host 0.0.0.0 --port 8000 --workers 1
```

Do not add `--reload` or additional workers. Azure documents [Python startup configuration](https://learn.microsoft.com/en-us/azure/app-service/configure-language-python#customize-startup-command) and [Always On](https://learn.microsoft.com/en-us/azure/app-service/configure-common).

Copy the placeholder settings once:

```bash
cp deploy/azure/appsettings.example.json deploy/azure/appsettings.local.json
```

Edit **appsettings.local.json** in your editor. It is gitignored and excluded from the ZIP. Keep the committed example file free of real keys. Replace every `REPLACE_...` placeholder using your working local configuration:

- `MODEL_API_KEY` and `META_MODEL`: existing working Meta credentials/model. The UI is named Remi; the provider remains `muse`.
- `GEMINI_VISION_API_KEY` and `GEMINI_MODEL`: your teammate's working computer-vision credentials/model.
- Both database-ID fields: your existing shared database ID, not a personal login identity.
- `CORS_ORIGINS`: comma-separated HTTPS origins for the Azure default hostname, your domain and `www` hostname. Include no URL paths.
- The two backend-token fields: copy matching working tokens if the adapters require them. Leave them empty only when the current public reducers allow the same operations without tokens.

The supplied `user` table settings match your current public name-only profile adapter. Do not publish/reset the shared database. The running API uses its configured URLs and credentials, not your personal SpacetimeDB CLI login or collaborator invitation.

### Temporary sessions on App Service

Keep **DATA_DIR=/tmp/remi** for this prototype. The code uses SQLite in WAL mode for API sessions. App Service's persistent application filesystem is a network share; Microsoft does not support SQLite there. Do not move this SQLite database under `/home` to try to make it persistent. See [Microsoft's SQLite limitation](https://learn.microsoft.com/en-us/troubleshoot/azure/app-service/faqs-app-service-linux-new#can-i-use-a-file-based-database-like-sqlite-with-my-linux-web-app).

With `MEMORY_PROVIDER=spacetimedb` and the supplied remote user/image configuration, household names, object memory and retained images stay in SpacetimeDB. The local session database can disappear after a container replacement or restart. This is a prototype hosting choice; durable session storage requires a backend change.

If an old browser session stops working after a deployment, test in a new private window, or clear just the saved session through the browser console:

```javascript
sessionStorage.removeItem('commonplace-guest-session');
sessionStorage.removeItem('commonplace-session');
location.reload();
```

A fresh session can select existing saved names. This does not clear shared database data.

## 4. Sign in and apply settings

Install Azure CLI if needed, then sign in:

```bash
brew install azure-cli
az login
az account list --output table
az account set --subscription "YOUR_STUDENT_SUBSCRIPTION_ID"
```

Under Azure → Environment variables → App settings, add the values from your private settings file. If using Advanced edit, merge entries into the existing list so unrelated settings are preserved. Alternatively, from your Mac apply the JSON file with Azure CLI:

```bash
az webapp config appsettings set \
  --resource-group remi-rg \
  --name remi \
  --settings @deploy/azure/appsettings.local.json \
  --output none
```

Use the private file only; do not apply the placeholder example. This command updates settings and can restart the app. Do not share the private file, screenshots of keys or debug logs. Azure supports [loading application settings from a JSON file](https://learn.microsoft.com/en-us/cli/azure/webapp/config/appsettings?view=azure-cli-latest#az-webapp-config-appsettings-set).

**SCM_DO_BUILD_DURING_DEPLOYMENT=true** must be set before ZIP deployment so Azure installs Python dependencies on Linux. The dependency file installs a regular package, avoiding editable references to a temporary build directory. See [Python build automation](https://learn.microsoft.com/en-us/azure/app-service/configure-language-python).

## 5. Deploy and test the default hostname

From the repository root:

```bash
az webapp deploy \
  --resource-group remi-rg \
  --name remi \
  --src-path remi-azure.zip \
  --type zip
```

Wait for deployment and package installation to complete. Browse the exact Azure default hostname and its `/api/health` route. The ZIP contains app files directly at its root, as required by [Azure ZIP deployment](https://learn.microsoft.com/en-us/azure/app-service/deploy-zip).

If startup fails, inspect Deployment Center → Logs and Monitoring → Log stream. Enable application logging to the filesystem in App Service logs when needed. Common causes:

| Symptom                                               | Check                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| Default Azure welcome page                            | Startup command and successful ZIP deployment.                     |
| `No module named commonplace_api`                     | Remote build setting and dependency-install logs.                  |
| `Frontend build is missing`                           | Rebuild using the packaging script and redeploy.                   |
| SQLite disk or locking error                          | DATA_DIR must be `/tmp/remi`, with one instance.                   |
| `CAMERA_SPACETIMEDB_URL must be an HTTP(S) server origin` | Add `CAMERA_SPACETIMEDB_URL=https://maincloud.spacetimedb.com`; the camera adapter needs its own URL even when `SPACETIMEDB_URL` is already set. |
| User list/upload/recognition failure                  | Matching remote URL, database ID, permissions, keys and model IDs. |
| Old browser shows no updates after server replacement | Start a fresh guest session as described above.                    |

Health reports configuration, not successful external-provider calls. Verify an actual user selection, scan/upload, recognized object, second-browser update, typed chat and voice on the deployed site.

### Startup timeout with `typing_extensions` under `/agents/python`

The deployment can finish installing dependencies but fail to start with:

```text
ImportError: cannot import name 'sentinel' from 'typing_extensions' (/agents/python/common/typing_extensions.py)
```

This means the automatic Application Insights agent loaded its bundled dependency ahead of the app's installed version. Disable that agent without changing application dependencies:

```bash
az webapp config appsettings set \
  --resource-group remi-rg \
  --name remi \
  --settings ApplicationInsightsAgent_EXTENSION_VERSION=disabled \
  --output none
```

Changing the setting restarts the app. Check the default hostname's `/api/health` after startup. If the process remains stopped, restart it from Azure Overview and inspect the latest startup logs:

```bash
az webapp log startup show --name remi --resource-group remi-rg
```

No new ZIP is needed when the only failure was this agent conflict. Azure's support team documents [Python dependency conflicts with the automatic monitoring agent](https://azureossd.github.io/2025/10/14/Python-on-App-Service-Linux-Depedency-conflicts-when-using-the-app-insights-codeless-agent/index.html). Custom-domain certificate binding does not resolve Python import errors.

## 6. Point GoDaddy DNS to Azure

Once the default Azure hostname works, open Azure → Custom domains → Add custom domain. Obtain the inbound IP and verification ID for your app. In GoDaddy → Domain Portfolio → your domain → DNS, configure:

| Type  | Name        | Value                                                       |
| ----- | ----------- | ----------------------------------------------------------- |
| A     | `@`         | Azure **inbound** IP address.                               |
| TXT   | `asuid`     | Azure domain verification ID.                               |
| CNAME | `www`       | Exact Azure default hostname, without `https://` or a path. |
| TXT   | `asuid.www` | Azure domain verification ID.                               |

Edit conflicting parking records for these exact hosts; preserve unrelated email/DNS records. If your authoritative nameservers are elsewhere, edit records at that DNS provider instead. Return to Azure and validate/add both your root domain and `www` hostname. Follow [Azure custom domains](https://learn.microsoft.com/en-us/azure/app-service/app-service-web-tutorial-custom-domain) and [GoDaddy DNS management](https://www.godaddy.com/en/help/manage-dns-records-680).

## 7. Add HTTPS

Use Azure Certificates → Managed certificates to request a certificate for each hostname. Under Custom domains, bind the appropriate certificate with SNI SSL. If the domain-add wizard already created/bound a managed certificate, check its status instead of creating a duplicate. Keep HTTPS Only enabled. Follow [Azure managed certificates](https://learn.microsoft.com/en-us/azure/app-service/configure-ssl-certificate#create-a-free-managed-certificate).

Test the root domain and `www` over HTTPS, then allow camera/microphone access on your actual phone. Browser voice and camera require a visible website; keeping Azure online does not keep a closed phone browser recording.

## 8. Future updates and rollback

Develop locally, run the relevant checks, save the version in Git, rebuild with `deploy/azure/package.py`, and repeat the ZIP deployment command. No domain or database republishing is required for ordinary frontend/backend changes. Azure settings remain configured. GitHub pushes alone do not deploy this manual ZIP setup.

Keep a copy of each known-working ZIP outside the project before building another one. Roll back code by deploying that ZIP with the same command. This does not roll back database changes or overwrite SpacetimeDB. Do not reset/publish a database module as part of routine website deployment.
