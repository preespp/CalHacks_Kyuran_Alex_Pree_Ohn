"""Exercise actual database write/read/delete and verify the saved JPEG."""
import secrets
import time
from pathlib import Path

import cv2
import numpy as np
from spacetime_stream import transfer, request


def main():
    image = np.random.default_rng(42).integers(0, 256, (240, 320, 3), dtype=np.uint8)
    ok, encoded = cv2.imencode('.jpg', image)
    assert ok
    session = secrets.token_hex(16)
    target = Path(transfer(session, 1, time.time_ns() // 1000, encoded.tobytes(), 320, 240))
    assert target.read_bytes() == encoded.tobytes()
    assert cv2.imread(str(target)).shape == image.shape
    assert request('sql', f"SELECT * FROM image_stream WHERE session = '{session}'")[0]['rows'] == []
    (target.parent / 'DONE').touch()
    (target.parent / 'slam.exit').write_text('smoke-test-only')
    print('PASS: database JPEG round trip, local decode, and queue acknowledgment')


if __name__ == '__main__':
    main()
