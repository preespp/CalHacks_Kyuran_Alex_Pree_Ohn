# Saved prototype users

The homepage and Household menu let you add a user by name or select an existing user from **Saved users**. No password or email is required. Selecting an existing user keeps that user's ID and issues a fresh session; entering a name creates a new user, even if the name matches someone else. The short ID in the picker distinguishes duplicate names.

All users share the `demo-home` prototype household. This picker intentionally allows switching identities without verification. It is a demo feature, not private account authentication.

## Temporary users while the database is not ready

The default is:

```dotenv
GUEST_PROFILE_STORE=auto
SPACETIMEDB_PROFILE_ACCESS=private
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

Use the [additive guest-table guide](../spacetimedb/guest-table/README.md) to merge a public, insert-only `guest_profile` table and `create_guest_profile` reducer into the teammate's actual module source. This preserves their other tables and needs no owner token at runtime. Set `SPACETIMEDB_PROFILE_ACCESS=public` only after the compatible table/reducer are published. Publishing still requires team management access; a public dashboard link does not provide that permission or the original source. The dashboard's `spacetime dev ... --template chat-react-ts` command generates a template and auto-publishes changes, rather than retrieving that source.

This mode stores unverified guest names publicly. It is appropriate for the shared prototype picker, not private accounts. It does not move image/object storage. The live teammate database has not been modified by preparing this addition.

## Keep users in a separate SpacetimeDB registry

As an alternative, use the [separate public users-only module guide](../spacetimedb/users/README.md). It avoids changing the teammate's existing schema and uses your own/team publishing access. This module now publishes `guest_profile` as public with insert-only guest creation. If you published its earlier private version, republish to that same users-only database ID before setting `SPACETIMEDB_PROFILE_ACCESS=public` and leaving the server token empty. Azure uses the backend HTTPS adapter and needs no CLI at runtime. The older private full-module registry setup below remains compatible for databases already running that schema.

## Existing full-module registry setup

This is a **profile registry integration**. It does not migrate images, object observations, or session-token hashes to SpacetimeDB. Those integrations remain separate. The app still uses its existing session API and SQLite for session hashes/object history; resetting that local database ends those sessions, but saved SpacetimeDB profiles can be selected again.

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
