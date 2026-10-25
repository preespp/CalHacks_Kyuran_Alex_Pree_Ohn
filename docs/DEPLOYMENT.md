# Vultr hosting, GoDaddy domain and future updates

Use one Ubuntu server: Nginx serves the built React app and proxies `/api/` to one FastAPI process. SpacetimeDB stores users, uploaded frames, live objects, history and retained evidence on the team database. Muse and Gemini remain external APIs. This path needs no Docker on your Mac or server.

```text
GoDaddy DNS → Vultr public IP → Nginx HTTPS
                                ├── React production files
                                └── /api → FastAPI on 127.0.0.1:8000
                                           ├── Muse / Gemini
                                           ├── hosted SpacetimeDB user and image-stream tables
                                           └── /var/lib/commonplace: app sessions / optional local-mode data
```

The source configurations are in [deploy/vultr](../deploy/vultr). They have not been installed on a live server by this change. Follow sections in order; commands marked **server** run over SSH, not in your Mac terminal's local project directory.

## 1. Finish local checks

```bash
npm run check
npm run test:module
make test
npm run test:browser
```

Run `make api` and `make web` locally for development. Confirm guest creation, image upload, shared memory in two browser sessions, Ask Muse, and voice on the actual device. The automated tests mock model APIs; they do not validate live model credentials.

Current boundaries matter for deployment:

- `VISION_PROVIDER=demo` disables the app's Gemini memory analysis even when a key is present. Use `gemini` with a tested vision key/model to enable it.
- Image upload confirms ingestion; the connected Onyu worker then reads the saved frame and commits remote object memory. Configure MEMORY_PROVIDER=spacetimedb and the published memory tables; see [live workflow](LIVE_WORKFLOW.md).
- The existing public `user` table works with `SPACETIMEDB_PROFILE_TABLE=user`. It does not need a new table or module publication. Guest names are unverified and all visitors share the demo household.
- Camera and Hello listening need an active browser and permissions. Keeping the API running does not keep a closed phone browser recording.

Commit and push the finished, tested changes to your team's repository before deploying. The build helper exports committed code only; it excludes your ignored local `.env` and `.data`.

## 2. Create the Vultr server

1. Sign in at [Vultr](https://my.vultr.com/). Apply the hackathon offer using its redemption instructions and check eligible products, expiry and remaining credit in your account. This guide does not assume a particular free allowance.
2. Deploy a **Cloud Compute** instance with **Ubuntu 24.04 LTS**, a nearby region and an SSH key. For this React build and CPU API, start around **2 vCPUs / 4 GB RAM** as a practical estimate; review the actual plan price before creating it. Gemini/Muse inference is remote, so this API path needs no GPU. The separate depth/SLAM experiments have different resource requirements.
3. Record the server's public IPv4 address. Add a Vultr firewall allowing TCP **80/443** publicly and **22** from your current IP where practical. Do not expose API port 8000, development port 5173 or local database ports.
4. SSH using the connection details Vultr supplies. Create/use a non-root sudo user called `deployer`, install its SSH public key, and verify a second SSH session works before changing SSH/firewall settings.

Vultr documents the [Ubuntu FastAPI/Nginx hosting pattern](https://docs.vultr.com/how-to-deploy-a-fastapi-application-with-gunicorn-and-nginx-on-ubuntu-2404). This repository uses one Uvicorn process supervised by systemd because camera jobs and guest state have process-local components.

### First SSH login

When creating the instance, select an SSH public key that belongs to your Mac. If you need a dedicated key, generate it **on your Mac**, then add the `.pub` contents to Vultr's SSH Keys and select it during server creation:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/commonplace_vultr
cat ~/.ssh/commonplace_vultr.pub
```

Keep the private key on your Mac. Replace `YOUR_SERVER_IP` below with the public IPv4 from Vultr. For a new Ubuntu instance provisioned with that key:

```bash
ssh -i ~/.ssh/commonplace_vultr root@YOUR_SERVER_IP
```

**Server**, during that first root session:

```bash
adduser deployer
usermod -aG sudo deployer
install -d -o deployer -g deployer -m 700 /home/deployer/.ssh
install -o deployer -g deployer -m 600 /root/.ssh/authorized_keys /home/deployer/.ssh/authorized_keys
```

`adduser` asks for the new user's password; it is used for sudo. Open a **second Mac terminal** and confirm the new login works before closing the root session:

```bash
ssh -i ~/.ssh/commonplace_vultr deployer@YOUR_SERVER_IP
sudo -v
```

Use this `deployer` session for the remaining server commands. If your instance already has a working non-root sudo user, use that account instead and substitute its name for `deployer` in the directory-ownership commands.

## 3. Install the server tools

**Server**, as `deployer`:

```bash
sudo apt update
sudo apt install -y git nginx python3.12-venv python3-pip ca-certificates curl snapd
```

Install **Node 24** for this same user using the [official Node download instructions](https://nodejs.org/en/download) for Linux and the server's CPU architecture. The repository's `.nvmrc` selects 24; Ubuntu's default Node package may be older. If using nvm, load it in your SSH shell before building.

```bash
node --version
npm --version
python3.12 --version
sudo useradd --system --user-group --home-dir /var/lib/commonplace --shell /usr/sbin/nologin commonplace
sudo install -d -o commonplace -g commonplace -m 700 /var/lib/commonplace
sudo install -d -o root -g commonplace -m 750 /etc/commonplace
sudo install -d -o deployer -g deployer -m 755 /srv/commonplace /srv/commonplace/releases /srv/commonplace/assets
```

Create the service user only once. Keep `/var/lib/commonplace` outside all release folders. Nginx serves only built frontend files; evidence images remain behind API session checks.

## 4. Clone code and configure backend secrets

**Server**: replace the repository URL if your team uses another repository.

```bash
git clone https://github.com/preespp/CalHacks_Kyuran_Alex_Pree.git /srv/commonplace/repo
sudo install -o root -g commonplace -m 640 /dev/null /etc/commonplace/commonplace.env
sudoedit /etc/commonplace/commonplace.env
```

If the repository is private, authorize this server with a repository-scoped, read-only GitHub deploy key or your team's approved Git authentication method. SSH access to Vultr does not automatically grant access to a private GitHub repository.

Create the environment file once; the `install /dev/null` command empties its target and must not be rerun over an existing configured file. Add these settings and your own tested keys in the editor. Do not paste secrets into chat, commit them or put them in `VITE_*` variables. This file uses environment-file syntax; do not execute it with `source`.

```dotenv
APP_ENV=prototype
DATA_DIR=/var/lib/commonplace
MEMORY_PROVIDER=spacetimedb
SEED_SAMPLE_DATA=false
VISION_ENRICHMENT=geometry
STORAGE_PROVIDER=local
CORS_ORIGINS=https://app.yourdomain.com

ASSISTANT_PROVIDER=muse
MODEL_API_KEY=YOUR_META_KEY
META_MODEL=YOUR_TESTED_META_MODEL
META_VOICE_MODEL=muse-voice-transcribe-1.0

VISION_PROVIDER=gemini
GEMINI_VISION_API_KEY=YOUR_VISION_KEY
GEMINI_MODEL=YOUR_TESTED_IMAGE_MODEL

GUEST_PROFILE_STORE=spacetimedb
SPACETIMEDB_PROFILE_ACCESS=public
SPACETIMEDB_PROFILE_TABLE=user
SPACETIMEDB_URL=https://maincloud.spacetimedb.com
SPACETIMEDB_DATABASE=c2005dfa977b978871c77ab400a529efd494fce3e8d3d60c2aa786050f6ebd02
SPACETIMEDB_SERVER_TOKEN=

CAMERA_FRAME_SINK=spacetimedb
CAMERA_SPACETIMEDB_URL=https://maincloud.spacetimedb.com
CAMERA_SPACETIMEDB_DATABASE=c2005dfa977b978871c77ab400a529efd494fce3e8d3d60c2aa786050f6ebd02
CAMERA_SPACETIMEDB_TOKEN=
```

For a temporary deployment without vision, use `VISION_PROVIDER=demo`. Without Muse credentials, use `ASSISTANT_PROVIDER=disabled`. The current public prototype user, upload and memory reducers need no owner token at runtime. If your teammate changes permissions, configure only the matching backend adapter's credential. No personal collaborator invitation or SpacetimeDB CLI login is needed by the running server. Your collaborators' development credentials do not automatically transfer to the server.

An earlier private `guest_profile` registry instead needs `SPACETIMEDB_PROFILE_TABLE=guest_profile`, its own database ID, `SPACETIMEDB_PROFILE_ACCESS=private` and a backend-only authorized token. Do not use those settings for the existing `user` table.

To bring existing local object history/photos to the server, stop your local API first and transfer the **entire** local DATA_DIR, including SQLite sidecar files if present and the images directory, through SSH into `/var/lib/commonplace`. Back up any existing server data before copying. Then restore ownership to `commonplace:commonplace` and private directory permissions. Do not merge two independently used SQLite files by copying one over the other. Starting empty seeds the sample records; remote saved names remain selectable either way.

## 5. Build a release and start FastAPI

**Server**, as `deployer`:

```bash
cd /srv/commonplace/repo
git fetch origin
bash deploy/vultr/build-release.sh origin/main
```

The helper builds into a new timestamped release, installs its own Python virtual environment, builds React and runs an isolated local smoke test. It makes no model calls or remote database changes. A failed build leaves the live release alone. Copy the **Built release** path printed at the end; substitute it below:

```bash
set -e
CP_RELEASE=/srv/commonplace/releases/PASTE_THE_BUILT_RELEASE_DIRECTORY
test -x "$CP_RELEASE/.venv/bin/python"
test -f "$CP_RELEASE/apps/web/dist/index.html"
ln -s "$CP_RELEASE" /srv/commonplace/current
sudo cp /srv/commonplace/current/deploy/vultr/commonplace.service /etc/systemd/system/commonplace.service
sudo systemctl daemon-reload
sudo systemctl enable --now commonplace
curl --fail --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:8000/api/health
```

The first `ln -s` is for a new installation only; use the update steps below if `current` already exists. Do not add `--reload` or multiple workers. Check logs if startup fails:

```bash
sudo systemctl status commonplace --no-pager
sudo journalctl -u commonplace -n 80 --no-pager
```

`/api/health` reports process configuration, not whether every external dependency is healthy. `GET /api/guest/users` verifies registry reads; test a new guest through the UI to verify writes. Test actual image upload separately from Gemini analysis.

## 6. Serve the frontend with Nginx

**Server**:

```bash
sudo cp /srv/commonplace/current/deploy/vultr/nginx.conf /etc/nginx/sites-available/commonplace
sudoedit /etc/nginx/sites-available/commonplace
```

Replace `app.yourdomain.com` in `server_name` with your real hostname. Then:

```bash
sudo ln -s /etc/nginx/sites-available/commonplace /etc/nginx/sites-enabled/commonplace
sudo nginx -t
sudo systemctl reload nginx
curl --fail -H 'Host: app.yourdomain.com' http://127.0.0.1/api/health
```

Keep unrelated existing Nginx sites. This config serves `/api/` through FastAPI, supports frontend routes such as `/camera`, and retains old hashed `/assets/` files for tabs opened before an update. Your browser uses same-origin `/api`; no public `localhost:8000` URL belongs in the frontend. Do not run `make web` or expose Vite for hosted traffic.

## 7. Buy the GoDaddy domain and point DNS to Vultr

1. Sign in to the team's retained [GoDaddy account](https://www.godaddy.com/domains) and search for an available name. If using a hackathon offer, follow its eligible extension/redemption rules before checkout. Review both registration and renewal prices.
2. Complete registration/contact verification. You need domain registration/DNS; the app's hosting is already on Vultr.
3. Start with **app.yourdomain.com**. In **Domain Portfolio → your domain → DNS**, add or update this one record:

| Type | Name | Value                          | TTL     |
| ---- | ---- | ------------------------------ | ------- |
| A    | app  | Your Vultr public IPv4 address | Default |

Keep unrelated DNS/email records. If `app` already has a CNAME or a wrong A/AAAA record, resolve that hostname's conflict. Add an AAAA record only if the server and Nginx are also configured for that IPv6 address. If nameservers are managed elsewhere, change DNS at that authoritative provider. See [GoDaddy's A-record instructions](https://www.godaddy.com/help/add-or-edit-an-a-record-42546).

On your Mac:

```bash
dig +short A app.yourdomain.com
```

Wait until it returns your server's IP. DNS changes may take time to propagate. A root-domain setup uses A record `@` instead; add any desired `www` hostname separately and include those names in Nginx and certificate issuance. A subdomain under your purchased domain is not another domain purchase.

## 8. Enable HTTPS before testing camera and microphone

**Server**, after DNS and ports 80/443 work:

```bash
sudo snap install --classic certbot
sudo /snap/bin/certbot --nginx -d app.yourdomain.com
sudo /snap/bin/certbot renew --dry-run
```

Complete Certbot's prompts and enable the HTTP-to-HTTPS redirect. The snap installs scheduled renewal; keep HTTP validation reachable. [Ubuntu's TLS guide](https://ubuntu.com/server/docs/how-to/security/obtain-tls-certificates/) documents this setup.

Open `https://app.yourdomain.com` on the actual iPhone. Confirm new guest saving, switching guests, camera permission, one capture every five seconds, a shared-memory update, evidence image retrieval, Ask Muse, typed input, microphone, Hello and spoken replies. Camera/microphone permissions belong to this HTTPS origin; localhost permissions do not transfer.

## 9. Update the website after local development

On your Mac: develop using `make api` + `make web`, pass section 1's checks, commit and push. Do not edit production source as your normal development workflow. GitHub's existing checks workflow validates code; it does not deploy automatically.

**Server**, as `deployer`:

```bash
cd /srv/commonplace/repo
git pull --ff-only origin main
git log -5 --oneline origin/main
bash deploy/vultr/build-release.sh origin/main
```

For a specific tested release, pass its full commit SHA instead of `origin/main`. The helper prints a new path. Build completely before stopping the running service. In the **same SSH session**, set that path, capture the previous release, stop the API and back up persistent data:

```bash
set -e
CP_RELEASE=/srv/commonplace/releases/PASTE_THE_NEW_BUILT_RELEASE_DIRECTORY
test -x "$CP_RELEASE/.venv/bin/python"
test -f "$CP_RELEASE/apps/web/dist/index.html"
CP_PREVIOUS=$(readlink -f /srv/commonplace/current)
sudo systemctl stop commonplace
CP_BACKUP="/var/backups/commonplace/$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -m 700 "$CP_BACKUP"
sudo cp -a /var/lib/commonplace/. "$CP_BACKUP/"
ln -sfn "$CP_RELEASE" /srv/commonplace/current.next
mv -Tf /srv/commonplace/current.next /srv/commonplace/current
sudo systemctl start commonplace
curl --fail --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:8000/api/health
```

There is a brief API interruption during this stop/start; camera uploads may need restarting. Check the public HTTPS UI and real flow after activation. Keep `/var/lib/commonplace`, `/etc/commonplace/commonplace.env`, shared assets and previous releases. New code does not need a new domain or DNS change while the server IP stays the same.

If configuration changed, edit the server environment file manually and restart the service; changing `.env` on your Mac does not update the host. If service/Nginx templates changed, review and install those changes separately. Run `systemctl daemon-reload` after a service-file change and `nginx -t` before reloading Nginx. Do not overwrite Certbot's installed TLS config with the original HTTP template during ordinary updates.

## 10. Roll back code and keep backups

If the new release fails, use the recorded previous path (or set it to the correct retained release directory):

```bash
set -e
test -x "$CP_PREVIOUS/.venv/bin/python"
sudo systemctl stop commonplace
ln -sfn "$CP_PREVIOUS" /srv/commonplace/current.next
mv -Tf /srv/commonplace/current.next /srv/commonplace/current
sudo systemctl start commonplace
curl --fail --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:8000/api/health
```

This rolls back code only. It does not restore older database state, change remote SpacetimeDB data or undo configuration edits. Keep schema changes compatible with retained releases. Do not overwrite current user data from a backup just to undo a frontend bug.

Copy backups off the VM through SSH or your chosen private backup service, and keep a private backup of the environment file separately. A disk retained across code releases can still be lost if the server is destroyed. Record the deployed commit, release path, domain and tested flow for teammates.
