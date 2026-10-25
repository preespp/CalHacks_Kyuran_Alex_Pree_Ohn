# Household members and sessions

This prototype uses display names without passwords, email or verified ownership. All members share `demo-home`; a saved name is not a private account. The browser automatically starts a Pree guest when no stored session exists.

Open **Household members**, directly under **How it works**, or click the profile. Enter a name in the full-width input and select **Add household member**. The new profile becomes active. Choose a saved name to return to its existing ID. Typing the same name again creates a distinct ID; short IDs distinguish duplicates.

Profile switching calls `/api/guest/session` with the current bearer, revokes that session and issues a new one. It clears the assistant conversation. Bearer sessions are stored as SQLite hashes and expire after 24 hours. The API supports deleting a guest session, but the current UI has no leave-session button.

## Registry modes

| `GUEST_PROFILE_STORE` | Persistence                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `local`               | In-process names reset on API restart. Old temporary-user sessions become invalid.                             |
| `sqlite`              | Saved names and sessions use local DATA_DIR.                                                                   |
| `spacetimedb`         | Names use the configured remote adapter; sessions still use local SQLite.                                      |
| `auto`                | Compatibility selection based on token/public-access settings, with temporary fallback for a missing database. |

For the team database's existing `user` table:

```dotenv
GUEST_PROFILE_STORE=spacetimedb
SPACETIMEDB_URL=https://maincloud.spacetimedb.com
SPACETIMEDB_DATABASE=YOUR_EXISTING_DATABASE_ID
SPACETIMEDB_PROFILE_TABLE=user
SPACETIMEDB_PROFILE_ACCESS=public
```

This adapter creates a distinct anonymous database identity and calls `set_name`. It does not require publishing a new guest table. Use a matching backend token only if its configured operations require it; do not share personal publishing credentials. The separate `guest_profile` modules are optional alternatives documented [here](../spacetimedb/README.md).

User-registry settings do not configure images/object memory. Resetting selectable local names does not delete remote observations or images. On Azure, temporary local session storage can disappear after container replacement; open a fresh private window or clear saved browser session keys as described in [deployment](AZURE_APP_SERVICE.md). Public prototype names remain in the remote registry.
