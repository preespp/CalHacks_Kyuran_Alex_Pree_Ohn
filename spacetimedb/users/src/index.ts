// Publish only to a users-only database created from this module, never the object database.
import { schema, table, t, SenderError } from 'spacetimedb/server';

const registryOwner = table(
  { name: 'registry_owner', public: false },
  {
    id: t.u8().primaryKey(),
    identity: t.identity(),
  },
);
const guestProfile = table(
  { name: 'guest_profile', public: true },
  {
    id: t.string().primaryKey(),
    household_id: t.string(),
    name: t.string(),
  },
);
const registry = schema({ registryOwner, guestProfile });
export default registry;

export const init = registry.init((ctx) => {
  // Retain this private table and initializer for existing registry deployments.
  ctx.db.registryOwner.insert({ id: 0, identity: ctx.sender });
});
export const createGuestProfile = registry.reducer(
  { name: 'create_guest_profile' },
  { id: t.string(), name: t.string() },
  (ctx, args) => {
    const name = args.name.trim();
    if (
      !/^guest-[a-f0-9]{32}$/.test(args.id) ||
      !name ||
      name.length > 50 ||
      /[\x00-\x1f\x7f]/.test(name)
    )
      throw new SenderError('Invalid guest profile');
    const existing = ctx.db.guestProfile.id.find(args.id);
    if (existing) {
      if (existing.household_id === 'demo-home' && existing.name === name) return;
      throw new SenderError('Guest ID already exists');
    }
    ctx.db.guestProfile.insert({ id: args.id, household_id: 'demo-home', name });
  },
);
