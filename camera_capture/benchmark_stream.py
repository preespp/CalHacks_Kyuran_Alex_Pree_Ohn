"""Measure quality scoring and the actual database path using a saved frame."""
import secrets
import time
from image_quality import TopFrameSelector
import spacetime_stream as stream


def main():
    source = max(stream.SPOOL.glob('*/*.jpg'), key=lambda path: path.stat().st_mtime)
    jpeg = source.read_bytes()
    session = secrets.token_hex(16)
    directory = stream.SPOOL / session
    directory.mkdir(parents=True)
    (directory / 'slam.exit').write_text('benchmark-only')
    original = stream.request
    def timed_request(route, payload):
        start = time.perf_counter()
        result = original(route, payload)
        print(f'{route}: {time.perf_counter() - start:.3f}s', flush=True)
        return result
    stream.request = timed_request
    selector = TopFrameSelector()
    for seq in range(1, 4):
        start = time.perf_counter()
        quality = selector.consider(seq, jpeg)
        print(f'quality: {time.perf_counter() - start:.3f}s; JPEG {len(jpeg)} bytes', flush=True)
        stream.transfer(session, seq, time.time_ns() // 1000, jpeg, quality.width, quality.height)
        print(f'total: {time.perf_counter() - start:.3f}s', flush=True)
    (directory / 'DONE').touch()


if __name__ == '__main__':
    main()
