import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import module, * as reducers from '../../camera_capture/stream_module/src/index.ts';

test('a large frame ingested by the real Python API satisfies the actual team reducer', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const script = `
import io, json, tempfile
from pathlib import Path
from unittest.mock import patch
import httpx
from PIL import Image
from fastapi.testclient import TestClient
from commonplace_api.config import Settings
from commonplace_api.main import create_app
raw = io.BytesIO()
Image.new('RGB', (2400, 1600), 'blue').save(raw, 'JPEG')
payloads = []
original = httpx.AsyncClient
def respond(request):
    payloads.append(json.loads(request.content))
    return httpx.Response(200)
with tempfile.TemporaryDirectory() as directory:
    settings = Settings(data_dir=Path(directory), guest_profile_store='local', camera_frame_sink='spacetimedb',
                        camera_spacetime_url='https://test.example', camera_spacetime_database='test')
    with patch('commonplace_api.frame_sink.httpx.AsyncClient', lambda **kw: original(transport=httpx.MockTransport(respond), **kw)):
        with TestClient(create_app(settings)) as client:
            token = client.post('/api/guest/session', json={'name': 'Contract test'}).json()['token']
            r = client.post('/api/camera/frames', headers={'Authorization':'Bearer '+token},
                            data={'scan_id':'contract-camera-test'}, files={'image':('test.jpg',raw.getvalue(),'image/jpeg')})
            assert r.status_code == 200, r.text
print(json.dumps(payloads[0]))
`;
  const result = spawnSync(`${root}/.venv/bin/python`, ['-c', script], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      DATA_DIR: `${root}/.data/module-contract-tests`,
      APP_ENV: 'development',
      GUEST_PROFILE_STORE: 'local',
      CAMERA_FRAME_SINK: 'disabled',
      MEMORY_PROVIDER: 'sqlite',
      SEED_SAMPLE_DATA: 'false',
      ASSISTANT_PROVIDER: 'disabled',
      VISION_PROVIDER: 'demo',
      STORAGE_PROVIDER: 'local',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const [session, sequence, capturedUs, width, height, jpeg] = JSON.parse(result.stdout);
  assert.equal(typeof jpeg, 'string');
  const args = {
    session,
    sequence,
    capturedUs: BigInt(capturedUs),
    width,
    height,
    jpeg: Uint8Array.from(Buffer.from(jpeg, 'hex')),
  };
  const db = createModuleTestHarness(module, reducers);
  const visitor = TestAuth.fromJwtPayload(
    JSON.stringify({ sub: 'anonymous-camera', iss: 'https://test.commonplace.local' }),
    new ConnectionId(9n),
  );
  assert.throws(
    () =>
      db.withReducerTx(visitor, (ctx) =>
        reducers.upload_binary_frame(ctx, { ...args, width: 2048 }),
      ),
    /Invalid JPEG frame/,
  );
  db.withReducerTx(visitor, (ctx) => reducers.upload_binary_frame(ctx, args));
  const saved = [...db.db.imageStreamBinary.iter()];
  assert.equal(saved.length, 1);
  assert.equal(saved[0].width, 1920);
  assert.deepEqual(saved[0].jpeg, args.jpeg);
}, 15000);
