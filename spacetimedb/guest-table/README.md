# Optional additive guest-profile snippet

The current application uses the existing team `user` table. See [users](../../docs/USERS.md); no new table is required for that path. This folder is an optional snippet for adding a distinct public `guest_profile` table to another reviewed module. It is not a standalone replacement module.

Obtain the actual deployed source and keep its existing tables, reducers and SDK version. Copy [guestProfiles.ts](guestProfiles.ts) beside the entry point, add `guestProfile` to its schema, and define a `create_guest_profile` reducer using `guestProfileParameters` and `insertGuestProfile`. Test the merged module locally before coordinating an additive publication with its owner.

Do not publish this repository's whole private-household module or a generated chat template over the team database. `spacetime dev ... --template chat-react-ts` creates a template/development workflow; it does not retrieve deployed source. Public table visibility does not grant schema-publishing access.

The snippet validates backend-generated guest IDs and single-line 1–50 character names, inserts into `demo-home`, permits exact retries and rejects changing an existing profile. It stores no credentials or object-placement attribution. For a separate registry module instead of a snippet, see [users/README.md](../users/README.md).
