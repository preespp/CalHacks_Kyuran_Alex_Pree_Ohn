# Add guest profiles to the existing team database

If you are using your own newly created users-only database, follow the [separate public registry guide](../users/README.md) instead. That guide covers republishing its earlier private version and configuring public access. The instructions below apply to merging into your teammate's existing module source.

This folder contains an **addition to your teammate's actual TypeScript module**, not a standalone replacement module. The hosted table has not been created by these changes. The last read-only schema check of `home-object-finder-i72wg` showed `user` and `message`, with no `guest_profile` table or `create_guest_profile` reducer.

The new table records guest profiles: `id`, `name`, and `household_id`. It does not store microphone recordings, passwords, session tokens, images, or who placed an object. All profiles belong to the prototype's `demo-home` household. Names are publicly readable and unverified, just like the prototype's name-only user picker.

## 1. Get the deployed module source

Ask the teammate who published the database for its actual source repository or project folder. Keep their existing tables, reducers, initialization, and SDK version. Do not publish this repository's full `spacetimedb/` module or the separate `spacetimedb/users/` module over that database.

The dashboard's suggested command:

```text
spacetime dev home-object-finder-i72wg --template chat-react-ts --server maincloud
```

initializes a template project and starts a development workflow that rebuilds and publishes changes automatically. The database name is its publish target. It does **not** retrieve the original deployed source. Do not use it as a shortcut for editing your friend's existing database.

Public tables can be read at runtime without the friend's login credentials, but publishing schema changes still requires the team's database-management access. You do not need their personal login token in this app or in Azure.

## 2. Merge the addition into that source

Copy [guestProfiles.ts](guestProfiles.ts) beside the teammate's module entry point. In that entry point, import:

```ts
import {
  guestProfile,
  guestProfileParameters,
  insertGuestProfile,
} from './guestProfiles';
```

Add `guestProfile` to the **existing** `schema(...)` table map. For example, if their module currently declares `const spacetime = schema({ user, message })`, change only that declaration to:

```ts
const spacetime = schema({ user, message, guestProfile });
```

Keep every other existing table in that map and the existing default export. Use their actual schema variable name, then add this reducer export:

```ts
export const createGuestProfile = spacetime.reducer(
  { name: 'create_guest_profile' },
  guestProfileParameters,
  insertGuestProfile,
);
```

The new reducer accepts a generated `guest-` UUID and a single-line display name of 1–50 characters. It only inserts a profile. Retrying the same ID/name is harmless; changing an existing profile is rejected. It has no operations against `user`, `message`, image, or object tables.

This is intentionally a public prototype registry: anonymous callers may add names and read them. It is not private account authentication. The app continues to issue its own guest session tokens through FastAPI.

## 3. Validate and publish the merged original module

Your teammate should typecheck/build their merged project and inspect the schema changes. The local composition test in this repository verifies that the addition leaves seeded example `user`/`message` rows unchanged; it does not prove compatibility with their unknown deployed source.

From the teammate's project, someone with publishing access can publish the merged module, using its actual module path:

```bash
spacetime publish --server maincloud --module-path PATH_TO_MERGED_MODULE --delete-data=never home-object-finder-i72wg
```

Replace `PATH_TO_MERGED_MODULE` before running. This is a live publication command; it has not been run here. Keep `--delete-data=never`. If publication reports an incompatible schema or asks to delete data, stop and correct the merge instead of enabling a reset. Check existing application behavior and rows after publication.

## 4. Connect the prototype after the table exists

Set these in the repository-root `.env`, then restart `make api`:

```dotenv
GUEST_PROFILE_STORE=spacetimedb
SPACETIMEDB_PROFILE_ACCESS=public
SPACETIMEDB_URL=https://maincloud.spacetimedb.com
SPACETIMEDB_DATABASE=home-object-finder-i72wg
SPACETIMEDB_SERVER_TOKEN=
```

This backend mode omits the SpacetimeDB Authorization header, even if another server token is configured. The runtime needs no SpacetimeDB CLI. For Azure, set the same ordinary environment variables on the backend; keep Meta/Gemini keys in backend secrets as before. These settings connect **only the saved-user registry**. Object memory, images, and session hashes retain their existing storage configuration.

Until publication is complete, leave `GUEST_PROFILE_STORE=auto` with `SPACETIMEDB_PROFILE_ACCESS=private` and no server token, or explicitly use `GUEST_PROFILE_STORE=local`. These modes keep temporary selectable users that reset when the API restarts. Setting `public` against a database without the required table produces a visible setup error; it does not create the table automatically.

## 5. Test through the UI

1. Run `make api` and `make web` in separate terminals.
2. Open `/`, add Pree, then open Household and add Alex.
3. Select Pree from Saved users and verify the original short ID is retained.
4. Restart the API and refresh. Both saved profiles should remain selectable with the same IDs. `/api/guest/users` should report `storage: spacetimedb`.
5. Confirm your friend's existing application and data still work. Do not remove their rows during this test.

Temporary local profiles are not copied to the remote table automatically. The standalone `/muse` test lab remains independent of the registry.

Local automated verification:

```bash
npm run typecheck
npm run test:module
make test
```

See the [official HTTP API documentation](https://spacetimedb.com/docs/http/database/) for database reads and reducer calls. A public table's visibility does not grant schema-management permission.
