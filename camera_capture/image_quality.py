from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True, slots=True)
class FrameQuality:
    frame_id: int
    width: int
    height: int
    sharpness: float
    brightness: float
    quality_score: float

    def as_dict(self) -> dict[str, int | float]:
        return {
            "frame_id": self.frame_id,
            "width": self.width,
            "height": self.height,
            "sharpness": round(self.sharpness, 1),
            "brightness": round(self.brightness, 1),
            "quality_score": round(self.quality_score, 1),
        }


@dataclass(frozen=True, slots=True)
class RankedFrame:
    quality: FrameQuality
    jpeg: bytes


class TopFrameSelector:
    """Score JPEG frames and retain only the highest-ranked candidates."""

    def __init__(self, limit: int = 3) -> None:
        if limit < 1:
            raise ValueError("limit must be at least 1")
        self.limit = limit
        self._frames: list[RankedFrame] = []

    @property
    def best_frames(self) -> tuple[RankedFrame, ...]:
        return tuple(self._frames)

    def consider(self, frame_id: int, jpeg: bytes) -> FrameQuality:
        encoded = np.frombuffer(jpeg, dtype=np.uint8)
        image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("The uploaded frame is not a valid JPEG image")

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        brightness = float(gray.mean())
        exposure_score = max(0.25, 1 - abs(brightness - 127.5) / 127.5)
        height, width = gray.shape
        quality = FrameQuality(
            frame_id=frame_id,
            width=width,
            height=height,
            sharpness=sharpness,
            brightness=brightness,
            quality_score=sharpness * exposure_score,
        )

        self._frames.append(RankedFrame(quality=quality, jpeg=jpeg))
        self._frames.sort(key=lambda candidate: candidate.quality.quality_score, reverse=True)
        del self._frames[self.limit:]
        return quality
