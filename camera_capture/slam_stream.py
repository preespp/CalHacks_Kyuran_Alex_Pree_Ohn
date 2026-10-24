"""A growing database-readback dataset for MASt3R-SLAM."""
import json
import time
from pathlib import Path
import cv2
from blur_filter import blur_score
from mast3r_slam.config import config

from mast3r_slam.dataloader import MonocularDataset


class SpacetimeDataset(MonocularDataset):
    def __init__(self, directory):
        super().__init__()
        self.dataset_path = Path(directory)
        self.use_calibration = False
        self.stride = 1
        self.blur_threshold = float(config['dataset'].get('blur_threshold', 0))
        self.seen_records = 0
        self.accepted = []

    def _refresh(self):
        manifest = self.dataset_path / 'frames.jsonl'
        if manifest.exists():
            content = manifest.read_text()
            # Ignore a final partially written line while capture appends.
            records = [json.loads(line) for line in content.splitlines(keepends=True) if line.endswith('\n')]
            for row in records[self.seen_records:]:
                image = cv2.imread(str(self.dataset_path / row['file']))
                if image is None:
                    raise ValueError(f"Cannot decode stored frame: {row['file']}")
                score = blur_score(image) if self.blur_threshold > 0 else 0
                if self.blur_threshold <= 0 or score >= self.blur_threshold:
                    self.accepted.append(row)
                else:
                    print(f"Blur filter skipped {row['file']}: {score:.1f} < {self.blur_threshold}", flush=True)
            self.seen_records = len(records)
            records = self.accepted[::self.stride]
            self.rgb_files = [str(self.dataset_path / row['file']) for row in records]
            self.timestamps = [row['timestamp'] for row in records]

    def __len__(self):
        self._refresh()
        return len(self.rgb_files) if (self.dataset_path / 'DONE').exists() else 99999999

    def subsample(self, stride):
        self.stride = max(1, stride)
        self._refresh()

    def read_img(self, idx):
        deadline = time.monotonic() + 120
        while True:
            self._refresh()
            if idx < len(self.rgb_files):
                return super().read_img(idx)
            if (self.dataset_path / 'DONE').exists():
                raise StopIteration
            if time.monotonic() > deadline:
                raise TimeoutError('No database frame received for 120 seconds')
            time.sleep(0.05)
