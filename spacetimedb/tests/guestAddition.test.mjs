import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import module, * as reducers from './fixtures/guestAddition.ts';

test('public guest creation adds only its table and preserves existing records', () => {
  const db = createModuleTestHarness(module, reducers);
  const visitor = TestAuth.fromJwtPayload(
    JSON.stringify({ sub: 'visitor', iss: 'https://test.commonplace.local' }),
    new ConnectionId(1n),
  );
  db.withReducerTx(visitor, (ctx) => {
    ctx.db.user.insert({ id: 'existing-user', name: 'Original name' });
    ctx.db.message.insert({ id: 'existing-message', text: 'Original message' });
  });
  const args = { id: `guest-${'a'.repeat(32)}`, name: ' Pree ' };
  db.withReducerTx(visitor, (ctx) => reducers.createGuestProfile(ctx, args));
  db.withReducerTx(visitor, (ctx) => reducers.createGuestProfile(ctx, args)); // Same retry is harmless.
  assert.equal(db.db.guestProfile.id.find(args.id).name, 'Pree');
  assert.equal(db.db.guestProfile.id.find(args.id).household_id, 'demo-home');
  assert.equal(db.db.user.id.find('existing-user').name, 'Original name');
  assert.equal(db.db.message.id.find('existing-message').text, 'Original message');
  assert.throws(
    () =>
      db.withReducerTx(visitor, (ctx) =>
        reducers.createGuestProfile(ctx, { ...args, name: 'Rename existing' }),
      ),
    /already exists/i,
  );
  assert.throws(
    () =>
      db.withReducerTx(visitor, (ctx) =>
        reducers.createGuestProfile(ctx, { ...args, id: 'wrong-format' }),
      ),
    /invalid/i,
  );
  assert.throws(
    () =>
      db.withReducerTx(visitor, (ctx) =>
        reducers.createGuestProfile(ctx, { id: `guest-${'b'.repeat(32)}`, name: 'bad\nname' }),
      ),
    /invalid/i,
  );
});
