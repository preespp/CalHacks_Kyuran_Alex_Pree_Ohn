"""Send a short real dataset sequence through the phone WebSocket path."""
import asyncio
import json
import os
import time
from pathlib import Path

import cv2
import websockets

ROOT = Path(__file__).resolve().parent


async def main():
    key = (ROOT / '.data/access-key').read_text().strip()
    source = ROOT.parents[1] / 'MASt3R-SLAM/datasets/tum/rgbd_dataset_freiburg1_desk/rgb'
    files = sorted(source.glob('*.png'))[:30:5]
    assert len(files) == 6
    saved = []
    host = os.getenv('CAMERA_TEST_URL', 'ws://127.0.0.1:8765')
    start = time.perf_counter()
    async with websockets.connect(f'{host}/ws/frames?key={key}') as socket:
        for i, path in enumerate(files, 1):
            ok, jpeg = cv2.imencode('.jpg', cv2.imread(str(path)))
            assert ok
            await socket.send(jpeg.tobytes())
            while True:
                result = json.loads(await socket.recv())
                assert result['type'] != 'error', result
                if result['type'] == 'frame':
                    assert result['transport'] == 'binary-websocket'
                    saved.append(result['frame_id'])
                if result['type'] == 'queued':
                    assert result['sequence'] == i
                    assert result['queue_depth'] <= 4
                    break
        session = result['session']
    # Accepted frames must drain even when the phone closes its connection.
    directory = ROOT / '.data/streams' / session
    for _ in range(300):
        if (directory / 'DONE').exists():
            break
        await asyncio.sleep(0.1)
    assert (directory / 'DONE').exists(), 'Queue did not drain'
    assert not (directory / 'ERROR').exists(), 'Transfer failed'
    rows = [json.loads(line) for line in (directory / 'frames.jsonl').read_text().splitlines()]
    assert [row['file'] for row in rows] == [f'{i:08d}.jpg' for i in range(1, 7)]
    print(f'PASS: bounded queue, six ordered binary database readbacks, drain after disconnect; {6 / (time.perf_counter() - start):.2f} FPS including connection startup; session {session}')


if __name__ == '__main__':
    asyncio.run(main())
