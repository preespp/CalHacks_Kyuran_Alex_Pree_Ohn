# Deployment and updates

The current primary deployment path is **Azure App Service + GoDaddy**, with React and FastAPI served together. Use [the complete Azure guide](AZURE_APP_SERVICE.md) for first deployment, environment variables, startup, DNS, HTTPS and updates.

```bash
.venv/bin/python deploy/azure/package.py
```

This builds/checks React and writes `remi-azure.zip`; it does not deploy. It excludes credentials and local data. Configure the app before uploading the ZIP. Normal website updates do not require new DNS records, a new domain or database schema publication.

Azure must use one API worker and instance. SQLite sessions use temporary `/tmp/remi`, while the configured SpacetimeDB user/image/object data remains remote. Do not put this SQLite WAL file on App Service's network filesystem. The guide describes restoring a fresh browser session after container replacement.

For a dedicated Ubuntu host instead, the optional [Vultr runbook](VULTR.md) uses Nginx and systemd with persistent local DATA_DIR outside release folders. Its configuration files live in `deploy/vultr`. It does not require local Docker.

Both paths require backend-only provider keys, tested database permissions and HTTPS for phone camera/microphone access. Keep a known-good artifact/version for code rollback. Deployment is not a database reset, and pushing GitHub alone does not deploy the manual ZIP workflow.
