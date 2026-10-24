import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import memory, * as reducers from '../src/index.ts';

function setup() {
  const db = createModuleTestHarness(memory, reducers);
  const auth = (name) =>
    TestAuth.fromJwtPayload(
      JSON.stringify({ sub: name, iss: 'https://test.commonplace.local' }),
      new ConnectionId(1n),
    );
  const alex = auth('alex');
  const pree = auth('pree');
  const worker = auth('vision-worker');
  const outsider = auth('outsider');
  const identity = (user) => db.withReducerTx(user, (ctx) => ctx.sender);
  db.withReducerTx(alex, (ctx) =>
    reducers.createHousehold(ctx, { id: 'home-a', name: 'A', displayName: 'Alex' }),
  );
  db.withReducerTx(outsider, (ctx) =>
    reducers.createHousehold(ctx, { id: 'home-b', name: 'B', displayName: 'Other' }),
  );
  return { db, alex, pree, worker, outsider, identity };
}

test('prototype guest registry permits only its household owner and preserves separate IDs', () => {
  const { db, alex, pree, outsider } = setup();
  const guestOwner = TestAuth.fromJwtPayload(
    JSON.stringify({ sub: 'guest-service', iss: 'https://test.commonplace.local' }),
    new ConnectionId(2n),
  );
  db.withReducerTx(guestOwner, (ctx) =>
    reducers.createHousehold(ctx, {
      id: 'demo-home',
      name: 'Prototype',
      displayName: 'Guest service',
    }),
  );
  const first = { id: `guest-${'a'.repeat(32)}`, name: 'Pree' };
  assert.throws(
    () => db.withReducerTx(pree, (ctx) => reducers.createGuestProfile(ctx, first)),
    /membership/i,
  );
  assert.throws(
    () => db.withReducerTx(outsider, (ctx) => reducers.createGuestProfile(ctx, first)),
    /demo-home/i,
  );
  assert.throws(
    () => db.withReducerTx(alex, (ctx) => reducers.createGuestProfile(ctx, first)),
    /demo-home/i,
  );
  db.withReducerTx(guestOwner, (ctx) => reducers.createGuestProfile(ctx, first));
  db.withReducerTx(guestOwner, (ctx) =>
    reducers.createGuestProfile(ctx, { id: `guest-${'b'.repeat(32)}`, name: 'Pree' }),
  );
  assert.equal(db.db.guestProfile.id.find(first.id).name, 'Pree');
  assert.throws(
    () =>
      db.withReducerTx(guestOwner, (ctx) =>
        reducers.createGuestProfile(ctx, { ...first, name: 'Someone else' }),
      ),
    /already exists/i,
  );
  assert.throws(
    () =>
      db.withReducerTx(guestOwner, (ctx) =>
        reducers.createGuestProfile(ctx, { ...first, id: 'pree' }),
      ),
    /Invalid guest ID/,
  );
});

test('invites are owner-issued, single use, and gate membership', () => {
  const { db, alex, pree, outsider } = setup();
  const code = 'unguessable-test-invite-code-1234567890';
  db.withReducerTx(alex, (ctx) => reducers.issueInvitation(ctx, { code }));
  db.withReducerTx(pree, (ctx) => reducers.joinHousehold(ctx, { code, displayName: 'Pree' }));
  assert.equal(reducers.myMembership(db.viewContext(pree)).householdId, 'home-a');
  assert.throws(
    () => db.withReducerTx(pree, (ctx) => reducers.issueInvitation(ctx, { code: code + '2' })),
    /owner/i,
  );
  assert.equal(reducers.householdObjects(db.viewContext(outsider)).length, 0);
  assert.equal(db.db.invitation.code.find(code), null);
});

test('only a granted worker can create visual evidence and foreign homes stay private', () => {
  const { db, alex, worker, outsider, identity } = setup();
  const workerIdentity = identity(worker);
  const args = {
    id: 'observation-1',
    householdId: 'home-a',
    objectId: 'adapter',
    label: 'Adapter',
    appearance: 'Silver adapter',
    room: 'Living room',
    location: 'On desk',
    imageKey: 'scene.jpg',
    bbox: [0.1, 0.2, 0.4, 0.5],
    observedAt: db.clock.now(),
  };
  assert.throws(
    () => db.withReducerTx(alex, (ctx) => reducers.recordVisualObservation(ctx, args)),
    /worker/i,
  );
  db.withReducerTx(alex, (ctx) => reducers.grantWorker(ctx, { identity: workerIdentity }));
  db.withReducerTx(worker, (ctx) => reducers.recordVisualObservation(ctx, args));
  assert.equal(reducers.householdObjects(db.viewContext(alex)).length, 1);
  assert.equal(reducers.householdObservations(db.viewContext(alex))[0].actor, undefined);
  assert.equal(reducers.householdObservations(db.viewContext(outsider)).length, 0);
  assert.throws(
    () =>
      db.withReducerTx(outsider, (ctx) =>
        reducers.reportLocation(ctx, {
          id: 'foreign-report',
          objectId: 'adapter',
          room: 'Kitchen',
          location: 'Drawer',
          kind: 'moved',
        }),
      ),
    /not found/i,
  );
  db.withReducerTx(alex, (ctx) => reducers.revokeWorker(ctx, { identity: workerIdentity }));
  assert.throws(
    () =>
      db.withReducerTx(worker, (ctx) =>
        reducers.recordVisualObservation(ctx, { ...args, id: 'observation-2' }),
      ),
    /worker/i,
  );
});
