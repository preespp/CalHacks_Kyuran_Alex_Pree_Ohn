// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS
// ─────────────────────────────────────────────────────────────────────────────
import { schema, t, table, SenderError } from 'spacetimedb/server';

const user = table(
  { name: 'user', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string().optional(),
    online: t.bool(),
  }
);

const message = table(
  { name: 'message', public: true },
  { sender: t.identity(), sent: t.timestamp(), text: t.string() }
);

const imageStream = table(
  { name: 'image_stream', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    session: t.string().index('btree'),
    sequence: t.u32(),
    capturedUs: t.u64(),
    width: t.u32(), height: t.u32(), jpegBase64: t.string(),
  }
);
// Separate binary table keeps the existing base64 schema/data compatible.
const imageStreamBinary = table(
  { name: 'image_stream_binary', public: true },
  {
    id: t.u64().primaryKey().autoInc(), session: t.string().index('btree'),
    sequence: t.u32(), capturedUs: t.u64(), width: t.u32(), height: t.u32(),
    jpeg: t.array(t.u8()),
  }
);
// Additive live-memory tables. Existing user/message/image schemas stay intact.
const visionCapture = table(
  { name: 'vision_capture', public: true },
  { id: t.string().primaryKey(), household_id: t.string().index('btree'),
    session: t.string(), sequence: t.u32(), captured_at: t.string(), room: t.string(),
    width: t.u32(), height: t.u32(), jpeg: t.array(t.u8()), object_count: t.u32() },
);
const objectMemory = table(
  { name: 'object_memory', public: true },
  { id: t.string().primaryKey(), household_id: t.string().index('btree'),
    object_id: t.string(), updated_at: t.string(), record_json: t.string() },
);
const objectSighting = table(
  { name: 'object_sighting', public: true },
  { id: t.string().primaryKey(), household_id: t.string().index('btree'),
    object_id: t.string().index('btree'), observed_at: t.string(), observation_json: t.string() },
);
const spacetimedb = schema({ user, message, imageStream, imageStreamBinary, visionCapture, objectMemory, objectSighting });
export default spacetimedb;

export const commit_vision_capture = spacetimedb.reducer(
  { householdId: t.string(), session: t.string(), sequence: t.u32(), capturedAt: t.string(), room: t.string(), objectsJson: t.string() },
  (ctx, { householdId, session, sequence, capturedAt, room, objectsJson }) => {
    // Public, name-only prototype: fixed shared household, no private-account claims.
    if (householdId !== 'demo-home' || !/^[a-f0-9]{32}$/.test(session) || sequence < 1 ||
        !room.trim() || room.length > 80 || !Number.isFinite(Date.parse(capturedAt)) || objectsJson.length > 524288)
      throw new SenderError('Invalid vision capture');
    const key = `stream-${session}-${sequence}.jpg`;
    const existing = ctx.db.visionCapture.id.find(key);
    if (existing) {
      if (existing.household_id !== householdId || existing.captured_at !== capturedAt)
        throw new SenderError('Capture identity conflict');
      return; // Idempotent retry; never overwrite retained evidence/history.
    }
    const frames = [...ctx.db.imageStreamBinary.session.filter(session)].filter(f => f.sequence === sequence);
    if (frames.length !== 1) throw new SenderError('Saved image is missing or ambiguous');
    const frame = frames[0];
    if (Math.abs(Date.parse(capturedAt) - Number(frame.capturedUs / 1000n)) > 1000)
      throw new SenderError('Image timestamp mismatch');
    let records;
    try { records = JSON.parse(objectsJson); } catch { throw new SenderError('Invalid object JSON'); }
    if (!Array.isArray(records) || records.length > 30) throw new SenderError('Invalid objects');
    const ids = new Set<string>();
    // Validate the entire batch before any insert; a reducer transaction is atomic.
    for (const record of records) {
      const o = record?.object;
      const obs = o?.latest;
      const b = obs?.bbox;
      if (!o || typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(o.id) || ids.has(o.id) ||
          typeof o.label !== 'string' || !o.label.trim() || o.label.length > 100 ||
          typeof o.appearance !== 'string' || o.appearance.length > 500 ||
          !Array.isArray(o.aliases) || o.aliases.length > 30 || o.aliases.some((a: unknown) => typeof a !== 'string' || a.length > 100) ||
          !obs || typeof obs.id !== 'string' || !/^[a-f0-9]{32}$/.test(obs.id) || obs.object_id !== o.id || obs.room !== room ||
          obs.source !== 'gemini' || obs.kind !== 'seen' || obs.observed_at !== capturedAt ||
          obs.image_url !== `/api/images/${key}` || typeof obs.location !== 'string' || !obs.location.trim() || obs.location.length > 300 ||
          !Array.isArray(b) || b.length !== 4 || b.some((v: unknown) => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) ||
          b[0] >= b[2] || b[1] >= b[3] || JSON.stringify(o.last_visual) !== JSON.stringify(obs) ||
          !Array.isArray(record.embedding) || record.embedding.length > 1024 || record.embedding.some((v: unknown) => typeof v !== 'number' || !Number.isFinite(v)))
        throw new SenderError('Invalid object observation');
      ids.add(o.id);
    }
    ctx.db.visionCapture.insert({ id: key, household_id: householdId, session, sequence, captured_at: capturedAt,
      room, width: frame.width, height: frame.height, jpeg: frame.jpeg, object_count: records.length });
    for (const record of records) {
      const obj = record.object;
      const id = `${householdId}:${obj.id}`;
      const previous = ctx.db.objectMemory.id.find(id);
      const next = { id, household_id: householdId, object_id: obj.id, updated_at: capturedAt, record_json: JSON.stringify(record) };
      if (!previous) ctx.db.objectMemory.insert(next);
      else if (Date.parse(capturedAt) > Date.parse(previous.updated_at)) ctx.db.objectMemory.id.update(next);
      ctx.db.objectSighting.insert({ id: `${householdId}:${obj.latest.id}`, household_id: householdId,
        object_id: obj.id, observed_at: capturedAt, observation_json: JSON.stringify(obj.latest) });
    }
  },
);

export const upload_binary_frame = spacetimedb.reducer(
  { session: t.string(), sequence: t.u32(), capturedUs: t.u64(), width: t.u32(), height: t.u32(), jpeg: t.array(t.u8()) },
  (ctx, args) => {
    if (!/^[a-f0-9]{32}$/.test(args.session) || args.sequence < 1 || args.width < 1 || args.height < 1 || args.width > 1920 || args.height > 1920 || args.jpeg.length > 1048576 || args.jpeg.length < 3 || args.jpeg[0] !== 255 || args.jpeg[1] !== 216 || args.jpeg[2] !== 255)
      throw new SenderError('Invalid JPEG frame');
    ctx.db.imageStreamBinary.insert({ id: 0n, ...args });
  }
);

export const acknowledge_binary_frame = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  if (ctx.sender.toHexString() !== 'c200c8fead17b327607f761eee6d15f253e8a33e01fae5c9731d377b9314e8ad')
    throw new SenderError('Capture backend only');
  ctx.db.imageStreamBinary.id.delete(id);
});

export const upload_image_frame = spacetimedb.reducer(
  { session: t.string(), sequence: t.u32(), capturedUs: t.u64(), width: t.u32(), height: t.u32(), jpegBase64: t.string() },
  (ctx, args) => {
    if (!/^[a-f0-9]{32}$/.test(args.session) || args.width < 1 || args.height < 1 || args.width > 1920 || args.height > 1920 || args.jpegBase64.length > 1400000 || !args.jpegBase64.startsWith('/9j/'))
      throw new SenderError('Invalid JPEG frame');
    ctx.db.imageStream.insert({ id: 0n, ...args });
  }
);

export const acknowledge_image_frame = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  if (ctx.sender.toHexString() !== 'c200c8fead17b327607f761eee6d15f253e8a33e01fae5c9731d377b9314e8ad')
    throw new SenderError('Capture backend only');
  ctx.db.imageStream.id.delete(id);
});

function validateName(name: string) {
  if (!name) throw new SenderError('Names must not be empty');
}

export const set_name = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    validateName(name);
    const user = ctx.db.user.identity.find(ctx.sender);
    if (!user) throw new SenderError('Cannot set name for unknown user');
    console.info(`User ${ctx.sender} sets name to ${name}`);
    ctx.db.user.identity.update({ ...user, name });
  }
);

function validateMessage(text: string) {
  if (!text) throw new SenderError('Messages must not be empty');
}

export const send_message = spacetimedb.reducer(
  { text: t.string() },
  (ctx, { text }) => {
    // Things to consider:
    // - Rate-limit messages per-user.
    // - Reject messages from unnamed user.
    validateMessage(text);
    console.info(`User ${ctx.sender}: ${text}`);
    ctx.db.message.insert({
      sender: ctx.sender,
      text,
      sent: ctx.timestamp,
    });
  }
);

// Called when the module is initially published
export const init = spacetimedb.init(_ctx => {});

export const onConnect = spacetimedb.clientConnected(ctx => {
  const user = ctx.db.user.identity.find(ctx.sender);
  if (user) {
    // If this is a returning user, i.e. we already have a `User` with this `Identity`,
    // set `online: true`, but leave `name` and `identity` unchanged.
    ctx.db.user.identity.update({ ...user, online: true });
  } else {
    // If this is a new user, create a `User` row for the `Identity`,
    // which is online, but hasn't set a name.
    ctx.db.user.insert({
      name: undefined,
      identity: ctx.sender,
      online: true,
    });
  }
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const user = ctx.db.user.identity.find(ctx.sender);
  if (user) {
    ctx.db.user.identity.update({ ...user, online: false });
  } else {
    // This branch should be unreachable,
    // as it doesn't make sense for a client to disconnect without connecting first.
    console.warn(
      `Disconnect event for unknown user with identity ${ctx.sender}`
    );
  }
});
