/**
 * Shared-memory backend for the next integration milestone.
 * The runnable local API currently uses SQLite; this module is not silently synced.
 * All tables are private. Clients subscribe only to membership-filtered views.
 */
import { schema, table, t, SenderError } from 'spacetimedb/server';
import type { InferSchema, ReducerCtx } from 'spacetimedb/server';

const household = table(
  { name: 'household', public: false },
  {
    id: t.string().primaryKey(),
    name: t.string(),
    owner: t.identity(),
  },
);
const membership = table(
  { name: 'membership', public: false },
  {
    identity: t.identity().primaryKey(),
    householdId: t.string().index('btree'),
    name: t.string(),
    role: t.string(),
  },
);
const invitation = table(
  { name: 'invitation', public: false },
  {
    code: t.string().primaryKey(),
    householdId: t.string(),
    expiresAtMicros: t.i64(),
  },
);
const worker = table(
  { name: 'worker', public: false },
  {
    id: t.string().primaryKey(),
    householdId: t.string(),
    identity: t.identity(),
  },
);
const object = table(
  { name: 'object', public: false },
  {
    id: t.string().primaryKey(),
    householdId: t.string().index('btree'),
    label: t.string(),
    appearance: t.string(),
    aliases: t.array(t.string()),
  },
);
const observation = table(
  { name: 'observation', public: false },
  {
    id: t.string().primaryKey(),
    householdId: t.string().index('btree'),
    objectId: t.string().index('btree'),
    room: t.string(),
    location: t.string(),
    imageKey: t.option(t.string()),
    bbox: t.option(t.array(t.f64())),
    source: t.string(),
    kind: t.string(),
    actor: t.identity(),
    observedAt: t.timestamp(),
    createdAt: t.timestamp(),
  },
);

const memory = schema({ household, membership, invitation, worker, object, observation });
export default memory;
type Context = ReducerCtx<InferSchema<typeof memory>>;

function text(value: string, max: number, field: string): string {
  if (!value.trim() || value.length > max)
    throw new SenderError(`${field} must contain 1–${max} characters`);
  return value.trim();
}

function requireMember(ctx: Context) {
  const member = ctx.db.membership.identity.find(ctx.sender);
  if (!member) throw new SenderError('Household membership required');
  return member;
}

function requireOwner(ctx: Context) {
  const member = requireMember(ctx);
  if (member.role !== 'owner') throw new SenderError('Household owner required');
  return member;
}

export const createHousehold = memory.reducer(
  { id: t.string(), name: t.string(), displayName: t.string() },
  (ctx, args) => {
    if (ctx.db.membership.identity.find(ctx.sender))
      throw new SenderError('This starter supports one household per identity');
    const id = text(args.id, 100, 'Household ID');
    ctx.db.household.insert({ id, name: text(args.name, 80, 'Household name'), owner: ctx.sender });
    ctx.db.membership.insert({
      identity: ctx.sender,
      householdId: id,
      name: text(args.displayName, 80, 'Display name'),
      role: 'owner',
    });
  },
);

// Generate an unguessable code client-side (32+ random characters). It is private and single use.
export const issueInvitation = memory.reducer({ code: t.string() }, (ctx, { code }) => {
  const member = requireOwner(ctx);
  if (code.length < 32 || code.length > 128)
    throw new SenderError('Use a random invitation code of 32–128 characters');
  ctx.db.invitation.insert({
    code,
    householdId: member.householdId,
    expiresAtMicros: ctx.timestamp.microsSinceUnixEpoch + 86_400_000_000n,
  });
});

export const joinHousehold = memory.reducer(
  { code: t.string(), displayName: t.string() },
  (ctx, args) => {
    if (ctx.db.membership.identity.find(ctx.sender))
      throw new SenderError('Already a household member');
    const invite = ctx.db.invitation.code.find(args.code);
    if (!invite || invite.expiresAtMicros <= ctx.timestamp.microsSinceUnixEpoch)
      throw new SenderError('Invitation is invalid or expired');
    ctx.db.membership.insert({
      identity: ctx.sender,
      householdId: invite.householdId,
      name: text(args.displayName, 80, 'Display name'),
      role: 'member',
    });
    ctx.db.invitation.code.delete(args.code);
  },
);

// The owner explicitly grants a separate backend identity permission to submit visual observations.
export const grantWorker = memory.reducer({ identity: t.identity() }, (ctx, { identity }) => {
  const member = requireOwner(ctx);
  const id = `${member.householdId}:${identity.toHexString()}`;
  if (!ctx.db.worker.id.find(id))
    ctx.db.worker.insert({ id, householdId: member.householdId, identity });
});

export const revokeWorker = memory.reducer({ identity: t.identity() }, (ctx, { identity }) => {
  const member = requireOwner(ctx);
  ctx.db.worker.id.delete(`${member.householdId}:${identity.toHexString()}`);
});

export const recordVisualObservation = memory.reducer(
  {
    id: t.string(),
    householdId: t.string(),
    objectId: t.string(),
    label: t.string(),
    appearance: t.string(),
    room: t.string(),
    location: t.string(),
    imageKey: t.string(),
    bbox: t.array(t.f64()),
    actor: t.identity(),
    observedAt: t.timestamp(),
  },
  (ctx, args) => {
    if (!ctx.db.worker.id.find(`${args.householdId}:${ctx.sender.toHexString()}`))
      throw new SenderError('Authorized vision worker required');
    const actor = ctx.db.membership.identity.find(args.actor);
    if (!actor || actor.householdId !== args.householdId)
      throw new SenderError('Capture contributor is not a household member');
    const [x1, y1, x2, y2] = args.bbox;
    if (
      args.bbox.length !== 4 ||
      args.bbox.some((n) => !Number.isFinite(n) || n < 0 || n > 1) ||
      x1 >= x2 ||
      y1 >= y2
    )
      throw new SenderError('Invalid normalized bounding box');
    if (args.observedAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch)
      throw new SenderError('Observation cannot be in the future');
    const existing = ctx.db.object.id.find(args.objectId);
    if (existing && existing.householdId !== args.householdId)
      throw new SenderError('Object belongs to another household');
    if (!existing)
      ctx.db.object.insert({
        id: text(args.objectId, 100, 'Object ID'),
        householdId: args.householdId,
        label: text(args.label, 100, 'Label'),
        appearance: text(args.appearance, 500, 'Appearance'),
        aliases: [],
      });
    ctx.db.observation.insert({
      id: text(args.id, 100, 'Observation ID'),
      householdId: args.householdId,
      objectId: args.objectId,
      room: text(args.room, 80, 'Room'),
      location: text(args.location, 300, 'Location'),
      imageKey: text(args.imageKey, 200, 'Image key'),
      bbox: args.bbox,
      source: 'gemini',
      kind: 'seen',
      actor: args.actor,
      observedAt: args.observedAt,
      createdAt: ctx.timestamp,
    });
  },
);

export const reportLocation = memory.reducer(
  {
    id: t.string(),
    objectId: t.string(),
    room: t.string(),
    location: t.string(),
    kind: t.string(),
  },
  (ctx, args) => {
    const member = requireMember(ctx);
    const target = ctx.db.object.id.find(args.objectId);
    if (!target || target.householdId !== member.householdId)
      throw new SenderError('Object not found');
    if (!['moved', 'found', 'correction'].includes(args.kind))
      throw new SenderError('Invalid report kind');
    ctx.db.observation.insert({
      id: text(args.id, 100, 'Observation ID'),
      householdId: member.householdId,
      objectId: args.objectId,
      room: text(args.room, 80, 'Room'),
      location: text(args.location, 300, 'Location'),
      imageKey: undefined,
      bbox: undefined,
      source: 'reported',
      kind: args.kind,
      actor: ctx.sender,
      observedAt: ctx.timestamp,
      createdAt: ctx.timestamp,
    });
  },
);

export const myMembership = memory.view(
  { name: 'my_membership', public: true },
  t.option(membership.rowType),
  (ctx) => ctx.db.membership.identity.find(ctx.sender) ?? undefined,
);
export const householdObjects = memory.view(
  { name: 'household_objects', public: true },
  t.array(object.rowType),
  (ctx) => {
    const member = ctx.db.membership.identity.find(ctx.sender);
    return member ? [...ctx.db.object.householdId.filter(member.householdId)] : [];
  },
);
export const householdObservations = memory.view(
  { name: 'household_observations', public: true },
  t.array(observation.rowType),
  (ctx) => {
    const member = ctx.db.membership.identity.find(ctx.sender);
    return member ? [...ctx.db.observation.householdId.filter(member.householdId)] : [];
  },
);
