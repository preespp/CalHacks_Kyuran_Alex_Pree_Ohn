import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import module, * as reducers from '../../camera_capture/stream_module/src/index.ts';

function fixture() {
  const db = createModuleTestHarness(module, reducers);
  const auth = TestAuth.fromJwtPayload(
    JSON.stringify({ sub: 'prototype', iss: 'https://test.local' }),
    new ConnectionId(2n),
  );
  const run = (name, args) => db.withReducerTx(auth, (ctx) => reducers[name](ctx, args));
  return { db, auth, run };
}

function frame(sequence, seconds) {
  return {
    session: 'a'.repeat(32),
    sequence,
    capturedUs: BigInt(seconds) * 1000000n,
    width: 100,
    height: 80,
    jpeg: Uint8Array.from([255, 216, 255, 0]),
  };
}

function commit(f, location = 'On the desk') {
  const capturedAt = new Date(Number(f.capturedUs / 1000n)).toISOString();
  const obs = {
    id: String(f.sequence).padStart(32, '0'),
    object_id: 'obj_real_cup',
    room: 'Office',
    location,
    image_url: `/api/images/stream-${f.session}-${f.sequence}.jpg`,
    bbox: [0.1, 0.2, 0.5, 0.6],
    source: 'gemini',
    kind: 'seen',
    observed_at: capturedAt,
    spatial: null,
    label: 'Cup',
  };
  const record = {
    object: {
      id: obs.object_id,
      label: 'Cup',
      appearance: 'Red cup',
      aliases: [],
      latest: obs,
      last_visual: obs,
    },
    embedding: [],
  };
  return {
    householdId: 'demo-home',
    session: f.session,
    sequence: f.sequence,
    capturedAt,
    room: 'Office',
    objectsJson: JSON.stringify([record]),
  };
}

test('live tables start empty; atomic commits preserve original users and queues, keep history and reject older latest updates', () => {
  const { db, auth, run } = fixture();
  db.withReducerTx(auth, (ctx) =>
    ctx.db.user.insert({ identity: ctx.sender, name: 'Original friend', online: false }),
  );
  assert.equal([...db.db.objectMemory.iter()].length, 0);
  const f1 = frame(1, 1760000000),
    f2 = frame(2, 1760000010),
    f3 = frame(3, 1760000005);
  for (const f of [f1, f2, f3]) run('upload_binary_frame', f);
  run('commit_vision_capture', commit(f1));
  run('commit_vision_capture', commit(f1)); // No duplicate sighting/image on retry.
  run('commit_vision_capture', commit(f2, 'On the shelf'));
  run('commit_vision_capture', commit(f3, 'Older observation'));
  const current = [...db.db.objectMemory.iter()];
  assert.equal(current.length, 1);
  assert.equal(JSON.parse(current[0].record_json).object.latest.location, 'On the shelf');
  assert.equal([...db.db.objectSighting.iter()].length, 3);
  assert.equal([...db.db.visionCapture.iter()].length, 3);
  assert.equal([...db.db.imageStreamBinary.iter()].length, 3);
  assert.deepEqual([...db.db.visionCapture.iter()][0].jpeg, f1.jpeg);
  assert.equal([...db.db.user.iter()][0].name, 'Original friend');
});

test('invalid observations roll back the whole batch and cannot refer to another frame or household', () => {
  const { db, run } = fixture();
  const f = frame(1, 1760000000);
  run('upload_binary_frame', f);
  const args = commit(f);
  for (const mutate of [
    (x) => {
      x.householdId = 'another-home';
    },
    (x) => {
      x.sequence = 99;
    },
    (x) => {
      x.capturedAt = '2000-01-01T00:00:00.000Z';
    },
    (x) => {
      const r = JSON.parse(x.objectsJson);
      r[0].object.latest.image_url = '/wrong.jpg';
      x.objectsJson = JSON.stringify(r);
    },
    (x) => {
      const r = JSON.parse(x.objectsJson);
      r[0].object.latest.bbox = [0, 0, 0, 0];
      x.objectsJson = JSON.stringify(r);
    },
  ]) {
    const wrong = structuredClone(args);
    mutate(wrong);
    assert.throws(() => run('commit_vision_capture', wrong));
    assert.equal([...db.db.visionCapture.iter()].length, 0);
    assert.equal([...db.db.objectMemory.iter()].length, 0);
    assert.equal([...db.db.objectSighting.iter()].length, 0);
  }
});
