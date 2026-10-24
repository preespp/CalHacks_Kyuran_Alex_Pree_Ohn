/** Add to the teammate's actual module; this file does not replace its schema. */
import { table, t, SenderError } from 'spacetimedb/server';

export const guestProfile = table(
  { name: 'guest_profile', public: true },
  { id: t.string().primaryKey(), household_id: t.string(), name: t.string() },
);

export const guestProfileParameters = { id: t.string(), name: t.string() };

type Profile = { id: string; household_id: string; name: string };
type GuestContext = {
  db: {
    guestProfile: {
      id: { find(id: string): Profile | null | undefined };
      insert(profile: Profile): unknown;
    };
  };
};

/** Prototype-only public, insert-only operation. No access to other tables. */
export function insertGuestProfile(ctx: GuestContext, args: { id: string; name: string }) {
  const name = args.name.trim();
  if (
    !/^guest-[a-f0-9]{32}$/.test(args.id) ||
    !name ||
    name.length > 50 ||
    /[\x00-\x1f\x7f]/.test(name)
  )
    throw new SenderError('Invalid guest ID or single-line name');
  const existing = ctx.db.guestProfile.id.find(args.id);
  if (existing) {
    if (existing.household_id === 'demo-home' && existing.name === name) return;
    throw new SenderError('Guest ID already exists');
  }
  ctx.db.guestProfile.insert({ id: args.id, household_id: 'demo-home', name });
}
