"""Bounded, temporary camera diagnostics using Fieldframe's original selector.

These best-ever frames are diagnostics, never substituted for a new observation:
an old sharp photograph must not overwrite a newer last-seen object location.
"""
from threading import Lock
import time

from camera_capture.image_quality import TopFrameSelector


class CameraFrames:
    def __init__(self, max_scans=16, ttl=600, clock=time.monotonic):
        self.max_scans = max_scans
        self.ttl = ttl
        self.clock = clock
        self._scans = {}
        self._lock = Lock()

    def observe(self, household, scan_id, jpeg):
        with self._lock:
            at = self.clock()
            for key in list(self._scans):
                if at - self._scans[key]["last"] > self.ttl:
                    del self._scans[key]
            key = (household, scan_id)
            if key not in self._scans:
                if len(self._scans) >= self.max_scans:
                    del self._scans[min(self._scans, key=lambda key: self._scans[key]["last"])]
                self._scans[key] = {"selector": TopFrameSelector(limit=3), "count": 0, "start": at, "last": at}
            scan = self._scans[key]
            quality = scan["selector"].consider(scan["count"] + 1, jpeg)
            scan["count"] += 1
            scan["last"] = at
            return {
                "received_frames": scan["count"],
                "received_fps": round((scan["count"] - 1) / max(at - scan["start"], .001), 2),
                "quality": quality.as_dict(),
                "top_frames": [frame.quality.as_dict() for frame in scan["selector"].best_frames],
            }
