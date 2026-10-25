# Saved prototype users

The homepage and Household menu let you add a user by name or select an existing user from **Saved users**. No password or email is required. Selecting an existing user keeps that user's ID and issues a fresh session; entering a name creates a new user, even if the name matches someone else. The short ID in the picker distinguishes duplicate names.

All users share the `demo-home` prototype household. This picker intentionally allows switching identities without verification. It is a demo feature, not private account authentication.

## Temporary users while the database is not ready

The default is:

```dotenv
GUEST_PROFILE_STORE=auto
SPACETIMEDB_PROFILE_ACCESS=private
SPACETIMEDB_PROFILE_TABLE=guest_profile
SPACETIMEDB_SERVER_TOKEN=
```

With the default private access mode and no server token, the API keeps selectable profiles in process memory. If a configured SpacetimeDB server returns 404 for the database itself, `auto` also uses this temporary mode. The picker explains that users are temporary.

1. Run `make api` and `make web` in separate terminals.
2. Open `/`, enter Pree, and select Continue as guest.
3. Open Household, enter Alex, and select Switch guest.
4. Open Household again and select **Use Pree (…)**. You return to Pree's original user ID. Leaving ends the session but keeps the selectable user for the rest of this test run.
5. Restart `make api` to begin a new user test run. The temporary picker becomes empty and previous temporary-user sessions are no longer accepted. Refresh the page to see it.

A browser refresh or frontend restart alone does not reset the backend's user list. The development server's Python auto-reload also starts a new backend process and therefore resets temporary users. Use one backend process in this mode; multiple processes would have separate temporary directories of users.

This resets **selectable users and their ability to use old sessions**, not the image store, object records, or report history. New object observations do not store contributor identities, and shared-memory API results omit actor IDs/names. Older SQLite rows may still contain legacy actor values; this change does not erase that historical data. We do not delete your teammate's images or existing household history.

To force this temporary behavior even while other database settings are present:

```dotenv
GUEST_PROFILE_STORE=local
```

## Keep users in local SQLite

If you want users available across API restarts before the cloud database is ready, set:

```dotenv
GUEST_PROFILE_STORE=sqlite
```

Restart `make api`. The picker reads guest members from the existing `DATA_DIR/memory.sqlite3` database, including earlier guest profiles retained there. Existing object and image behavior remains the same. No extra server is needed.

## Keep users in the team's existing public database

The merged camera module already publishes `user(identity, name: Option<string>, online)` and `set_name`. Use it directly:

```dotenv
GUEST_PROFILE_STORE=spacetimedb
SPACETIMEDB_PROFILE_TABLE=user
SPACETIMEDB_PROFILE_ACCESS=public
SPACETIMEDB_URL=https://maincloud.spacetimedb.com
SPACETIMEDB_DATABASE=c2005dfa977b978871c77ab400a529efd494fce3e8d3d60c2aa786050f6ebd02
SPACETIMEDB_SERVER_TOKEN=
```

Restart `make api` after changing configuration. There is no table to create or module to publish. Each new guest opens a short anonymous SpacetimeDB WebSocket connection. Its existing `on_connect` creates a fresh user identity; the backend calls `set_name` using only that new identity's temporary token, confirms the row by reading `user`, then closes the connection and discards the token. Your friend's existing users are never renamed. Public named rows appear in the picker; unnamed connections are skipped. The `online` flag reflects that short database connection, not whether a person is currently browsing our app.

The API derives a stable `guest-...` ID from each full database identity. Two people with the same name still have different IDs; selecting a saved profile creates no new database row. App sessions remain random bearer tokens hashed in local SQLite. These names are unverified and shared publicly; this adapter does not grant private-account authentication.

To test: add a name, check `user` in your friend's dashboard, restart the API, and select that same name/short ID from Saved users. `GET /api/guest/users` reports `storage: spacetimedb`. Earlier temporary users are not copied automatically. The local `.env` is configured for this mode; the live integration check added one name, **Integration check**.

The older [additive guest-table guide](../spacetimedb/guest-table/README.md) remains an alternative. Use `SPACETIMEDB_PROFILE_TABLE=guest_profile` only for a database that actually publishes `guest_profile` and `create_guest_profile`.

## Keep users in a separate SpacetimeDB registry

As an alternative, use the [separate public users-only module guide](../spacetimedb/users/README.md). It avoids changing the teammate's existing schema and uses your own/team publishing access. This module now publishes `guest_profile` as public with insert-only guest creation. If you published its earlier private version, republish to that same users-only database ID before setting `SPACETIMEDB_PROFILE_ACCESS=public` and leaving the server token empty. Vultr uses the backend HTTPS adapter and needs no CLI at runtime. The older private full-module registry setup below remains compatible for databases already running that schema.

## Existing full-module registry setup

This is a **profile registry integration**. It does not migrate images, object observations, or session-token hashes to SpacetimeDB. Those integrations remain separate. The app still uses its existing session API and SQLite for session hashes; object history uses the independently selected MEMORY_PROVIDER; resetting that local database ends those sessions, but saved SpacetimeDB profiles can be selected again.

### Prepare the module with your database teammate

The repository's module adds a private **guest_profile** table and a **create_guest_profile** reducer. The table stores only `id`, `household_id`, and `name`. No image bytes, raw session tokens, Meta keys, or Gemini keys go into it.

If your teammate has changed the module for image storage, merge these additions into that same module before publishing. Do not publish this scaffold over their database without their schema changes, and do not use destructive data-reset flags. You can also use a separate test database for this user registry; it does not need to hold the images.

From the repository root, for a new local test database:

```bash
spacetime publish --server local --module-path spacetimedb commonplace-users-test
```

Use the same CLI/server generation as the SDK resolved in `package-lock.json`. The implementation was checked with 2.13.0. This command publishes a module when you run it; the agent's validation used an isolated temporary server instead of your teammate's database.

### Establish the backend registry identity

For this prototype adapter, the backend's SpacetimeDB token must belong to the database owner (for private SQL reads), and that identity must own the `demo-home` household (for the write reducer). With that CLI identity, initialize a new registry household once:

```bash
spacetime call --server local commonplace-users-test create_household '"demo-home"' '"Prototype home"' '"Guest registry service"'
```

Skip initialization if that identity already owns `demo-home`. If it belongs to a different household, use a separate registry test database or coordinate the identity mapping with the teammate; this starter permits one household per SpacetimeDB identity. A successful directory read does not by itself prove the reducer write permission is configured.

Use the token for that same database-owner identity. `spacetime login show --token` displays the current CLI login token; handle that output privately. If your database was created using a different anonymous/local identity, use its actual owner token instead. A Meta Model API key is not a SpacetimeDB credential.

### Configure the backend

Add to the repository-root `.env`:

```dotenv
GUEST_PROFILE_STORE=auto
SPACETIMEDB_PROFILE_ACCESS=private
SPACETIMEDB_PROFILE_TABLE=guest_profile
SPACETIMEDB_URL=http://127.0.0.1:3000
SPACETIMEDB_DATABASE=commonplace-users-test
SPACETIMEDB_SERVER_TOKEN=YOUR_PRIVATE_DATABASE_OWNER_TOKEN
```

For a hosted database, use its HTTPS server origin and actual database name. Never place the token in `VITE_*`, frontend code, screenshots, Git, or chat. The backend uses it for HTTP SQL reads and reducer calls. See the [official HTTP API](https://spacetimedb.com/docs/http/database/).

Restart `make api`. Check `/api/guest/users`: `storage` should be `spacetimedb`. Add two users, switch back to one, restart the API, and verify that the same IDs are still selectable. A GET of `/api/health` also reports `guest_profile_store`.

To require a database connection with no missing-database fallback, use `GUEST_PROFILE_STORE=spacetimedb`. Permission, network, incompatible-response, and missing-table errors are shown rather than silently replacing a configured registry with an empty local one. The store is selected at backend startup; after provisioning or fixing configuration, restart the API. Temporary users are not automatically copied into the remote database.

## Verification

```bash
make test
npm run test:module
npm run check
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:browser
```

Automated checks cover existing-user selection, fresh sessions/revocation, temporary reset, SQLite persistence, remote HTTP contracts, missing-database fallback, visible configuration errors, and reducer permissions. A separate isolated local SpacetimeDB check verified actual profile create/list/API-restart/reselection. It did not connect to your teammate's database or spend AI credits.
