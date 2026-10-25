"""Check actual binary readbacks, ordering, cleanup, and confirmed throughput."""
import asyncio
import json
import secrets
import time
from pathlib import Path

from binary_stream import BinaryStream, SPOOL
from image_quality import TopFrameSelector
from spacetime_stream import request


async def main():
    source = max(SPOOL.glob('*/*.jpg'), key=lambda path: path.stat().st_mtime)
    jpeg = source.read_bytes()
    quality = TopFrameSelector().consider(1, jpeg)
    session = secrets.token_hex(16)
    directory = SPOOL / session
    directory.mkdir(parents=True)
    (directory / 'slam.exit').write_text('binary-check-only')
    count = 20
    async with BinaryStream(session) as stream:
        start = time.perf_counter()
        # Four in flight, matching the receiver's hard limit.
        for first in range(1, count + 1, 4):
            paths = await asyncio.gather(*(stream.transfer(seq, time.time_ns() // 1000,
                jpeg, quality.width, quality.height) for seq in range(first, first + 4)))
            assert all(Path(path).read_bytes() == jpeg for path in paths)
        elapsed = time.perf_counter() - start
    rows = [json.loads(line) for line in (directory / 'frames.jsonl').read_text().splitlines()]
    assert [row['file'] for row in rows] == [f'{seq:08d}.jpg' for seq in range(1, count + 1)]
    assert request('sql', f"SELECT * FROM image_stream_binary WHERE session = '{session}'")[0]['rows'] == []
    (directory / 'DONE').touch()
    print(f'PASS: {count} exact binary readbacks, ordered manifest, acknowledged cleanup; {count / elapsed:.2f} confirmed FPS, JPEG {len(jpeg)} bytes')


if __name__ == '__main__':
    asyncio.run(main())
