import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import registry, * as reducers from '../users/src/index.ts';

test('public registry accepts visitors, preserves existing profiles, and validates names', () => {
  const db = createModuleTestHarness(registry, reducers);
  const auth = (name) =>
    TestAuth.fromJwtPayload(
      JSON.stringify({ sub: name, iss: 'https://test.commonplace.local' }),
      new ConnectionId(1n),
    );
  const owner = auth('registry-owner');
  const other = auth('other');
  db.withReducerTx(owner, (ctx) => reducers.init(ctx));
  const initialOwner = db.db.registryOwner.id.find(0).identity;
  const first = { id: `guest-${'a'.repeat(32)}`, name: 'Pree' };
  db.withReducerTx(owner, (ctx) => reducers.createGuestProfile(ctx, first));
  db.withReducerTx(other, (ctx) => reducers.createGuestProfile(ctx, first));
  const second = { id: `guest-${'b'.repeat(32)}`, name: ' Alex ' };
  db.withReducerTx(other, (ctx) => reducers.createGuestProfile(ctx, second));
  assert.equal(db.db.guestProfile.id.find(first.id).household_id, 'demo-home');
  assert.equal(db.db.guestProfile.id.find(second.id).name, 'Alex');
  assert.throws(
    () =>
      db.withReducerTx(other, (ctx) => reducers.createGuestProfile(ctx, { ...first, id: 'bad' })),
    /invalid/i,
  );
  assert.throws(
    () =>
      db.withReducerTx(other, (ctx) =>
        reducers.createGuestProfile(ctx, { ...first, name: 'Changed' }),
      ),
    /already exists/i,
  );
  for (const name of ['', 'a'.repeat(51), 'bad\nname']) {
    assert.throws(
      () =>
        db.withReducerTx(other, (ctx) =>
          reducers.createGuestProfile(ctx, { id: `guest-${'c'.repeat(32)}`, name }),
        ),
      /invalid/i,
    );
  }
  assert.equal(db.db.guestProfile.id.find(first.id).name, 'Pree');
  assert.ok(db.db.registryOwner.id.find(0).identity.isEqual(initialOwner));
});
