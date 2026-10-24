"""Check blur rejection and the actual 224px SLAM dataset path in the SLAM venv."""
from pathlib import Path
import sys
import tempfile
import json
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parents[1] / 'MASt3R-SLAM'))
from mast3r_slam.config import load_config
from blur_filter import blur_score
from slam_stream import SpacetimeDataset

load_config('config/iphone_224.yaml')
image = np.random.default_rng(42).integers(0, 256, (480, 640, 3), dtype=np.uint8)
blurred = cv2.GaussianBlur(image, (51, 51), 15)
assert blur_score(image) > 30 > blur_score(blurred)
with tempfile.TemporaryDirectory() as temp:
    folder = Path(temp)
    for name, pic in [('sharp.jpg', image), ('blurred.jpg', blurred)]:
        cv2.imwrite(str(folder / name), pic)
    (folder / 'frames.jsonl').write_text(''.join(json.dumps({'file': name, 'timestamp': i}) + '\n'
        for i, name in enumerate(['sharp.jpg', 'blurred.jpg'])))
    (folder / 'DONE').touch()
    dataset = SpacetimeDataset(folder)
    assert len(dataset) == 1
    assert len(dataset) == 1  # Repeated refresh must not duplicate records.
    assert dataset.timestamps == [0]
    assert tuple(dataset.get_img_shape()[0]) == (224, 224)
    (folder / 'frames.jsonl').write_text(json.dumps({'file': 'blurred.jpg', 'timestamp': 1}) + '\n')
    empty = SpacetimeDataset(folder)
    assert len(empty) == 0
    try:
        empty.get_img_shape()
        raise AssertionError('Expected end of filtered dataset')
    except StopIteration:
        pass
print('PASS: blur rejection, timestamp preservation, no duplicate refresh, 224x224 model input, all-blurry end')
dataset = SpacetimeDataset(ROOT / '.data/streams/157193882aebfb28055ea8c17ce3bb1c')
print(f'Latest phone capture: {len(dataset)}/20 frames retained')
