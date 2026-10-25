# Optional separate guest-profile registry

This public module stores insert-only `guest_profile` rows: `id`, `household_id` and `name`. IDs are backend-generated `guest-` plus 32 hex characters; the household is `demo-home`, and names are trimmed single-line strings of 1–50 characters. Repeating the same ID/name is harmless; changing an existing profile is rejected. The retained private owner table supports earlier schema versions but is not required for public creation.

This module is **not needed for the normal team database**, which already uses the public `user`/`set_name` adapter. Do not publish it over that database or replace its image/object tables.

For an intentionally separate registry, install the SpacetimeDB CLI using its official instructions, sign in with your own publishing access and review `spacetime publish --help` for the installed version. From the project root, the established command for updating your own existing registry is:

```bash
spacetime publish --server maincloud --module-path spacetimedb/users --no-config --delete-data=never YOUR_USERS_DATABASE_ID
```

Target only a separate registry you manage. A schema incompatibility should be resolved with a migration, not a data reset. Runtime consumers do not need your personal CLI login.

Configure the API for that registry:

```dotenv
GUEST_PROFILE_STORE=spacetimedb
SPACETIMEDB_URL=https://maincloud.spacetimedb.com
SPACETIMEDB_DATABASE=YOUR_USERS_DATABASE_ID
SPACETIMEDB_PROFILE_TABLE=guest_profile
SPACETIMEDB_PROFILE_ACCESS=public
```

Leave camera/object configuration pointed at its separate existing database. This registry contains unverified public display names, not session secrets, passwords, microphone recordings or who placed objects. See [user modes](../../docs/USERS.md).
