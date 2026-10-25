# SpacetimeDB modules in this repository

The active Remi prototype uses **`camera_capture/stream_module/src/index.ts`**, not this folder's private-household module. Its public `user`, image-stream, `vision_capture`, `object_memory` and `object_sighting` contract is described in [the pipeline guide](../docs/IMAGE_PIPELINE.md).

| Source                             | Purpose                                                                  | Active default?                           |
| ---------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------- |
| `../camera_capture/stream_module/` | Team public user/image/object-memory module                              | Yes, when remote providers are configured |
| `src/index.ts`                     | Alternative private household, invitation, worker and scoped-view design | No                                        |
| `users/`                           | Separate public `guest_profile` registry                                 | Optional alternative                      |
| `guest-table/guestProfiles.ts`     | Additive guest-profile snippet for another reviewed module               | Optional alternative                      |

The existing team `user` table works without adding a `guest_profile` table. App environment settings select the adapters; they do not migrate schemas or publish these modules automatically.

## Develop and test

From the repository root:

```bash
npm ci
npm run typecheck
npm run test:module
```

These local module tests check camera commit validation, guest additions, registry behavior and alternative permission boundaries. They do not connect to or reset a hosted database.

## Publishing boundaries

Publishing needs database-management access and the actual source currently deployed to the target. Never publish `src/` or `users/` over the team's camera database. Preserve existing schema/data and use additive migrations reviewed with the owner. Do not use a generated chat template as a way to retrieve or update deployed source.

Public read access, reducer write permissions and collaborator/publishing access are separate. The running backend uses URLs and matching runtime credentials, not a developer's CLI login. Normal Azure website updates do not republish SpacetimeDB.

The private module implements households, membership/invitations, worker grants, private objects/observations, legacy reports and scoped views. Its identity-scoped subscriptions are an alternative design, not the current frontend's five-second HTTP polling.
