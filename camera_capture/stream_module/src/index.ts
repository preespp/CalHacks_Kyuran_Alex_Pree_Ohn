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
const spacetimedb = schema({ user, message, imageStream, imageStreamBinary });
export default spacetimedb;

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
