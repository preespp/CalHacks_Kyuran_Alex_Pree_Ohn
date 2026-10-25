# Shared-memory module

This is a typechecked SpacetimeDB module. The optional **saved-user profile registry** is connected to FastAPI through HTTP; see [the user storage guide](../docs/USERS.md). Object/observation tables, vision workers, and live frontend subscriptions remain **not yet connected** to the runnable SQLite-backed app. Existing SQLite data is not imported automatically.

To add only public guest profiles to your teammate's existing module, use the [additive guest-table guide](guest-table/README.md). Do not publish this full module over their deployed source. The public addition is prepared locally and has not been published to their database.

The root `npm ci` installs the module's SDK dependency. Install the [SpacetimeDB CLI](https://spacetimedb.com/install) separately to publish it. Match the CLI/server release to the SDK version resolved in `package-lock.json`.

From this directory, with a local server started in a separate terminal:

```bash
spacetime start
```

Publish and generate bindings in another terminal from this directory:

```bash
spacetime publish --server local commonplace-dev
spacetime generate --lang typescript --out-dir ../apps/web/src/module_bindings
```

These follow the CLI's module-directory workflow. Confirm `spacetime publish --help` and `spacetime generate --help` against the installed release if flags differ. No generated bindings are committed before a real module build succeeds. The current scaffold's verification uses SDK types and the official module test harness; it does not establish a successful CLI deployment.

## Schema and operations

All tables are private: household, membership, invitation, worker, object, observation, and guest_profile. One identity belongs to one household in this initial schema.

- `createGuestProfile` (HTTP name `create_guest_profile`): the demo-home owner creates selectable string-ID prototype profiles; private reads require the database owner token held by FastAPI. These guest profiles are distinct from native SpacetimeDB membership identities.
- `createHousehold`: create a household and its owner membership.
- `issueInvitation`: owner creates a single-use, 24-hour invitation. Generate at least 32 random characters client-side; do not use a predictable phrase.
- `joinHousehold`: consume the invitation and join as a member.
- `grantWorker` / `revokeWorker`: owner controls a separate backend identity's ability to submit visual observations.
- `recordVisualObservation`: granted worker records image evidence with a validated normalized box and no contributor identity. The legacy optional actor column remains unset; publishing this schema change requires coordination with the database teammate.
- `reportLocation`: legacy member location-report reducer; writes no visual evidence or contributor. The app now uses camera scanning for updates.
- `my_membership`, `household_objects`, `household_observations`: identity-filtered subscribable views.

To integrate, generate bindings, connect the browser with a stable authenticated identity, create/join the household through reducers, and subscribe to these views. Then replace the local API storage implementation and authorize the worker identity. Never expose the worker's credentials to the browser or make the source tables public as a shortcut.

Run `npm run test:module` from the root for invitation, worker permission, and cross-household isolation checks. The SDK harness runs without a live SpacetimeDB server.
