// Composition fixture only, not the friend's deployed module or a publish target.
import { schema, table, t } from 'spacetimedb/server';
import {
  guestProfile,
  guestProfileParameters,
  insertGuestProfile,
} from '../../guest-table/guestProfiles';

const user = table(
  { name: 'user', public: true },
  { id: t.string().primaryKey(), name: t.string() },
);
const message = table(
  { name: 'message', public: true },
  { id: t.string().primaryKey(), text: t.string() },
);
const module = schema({ user, message, guestProfile });
export default module;
export const createGuestProfile = module.reducer(
  { name: 'create_guest_profile' },
  guestProfileParameters,
  insertGuestProfile,
);
