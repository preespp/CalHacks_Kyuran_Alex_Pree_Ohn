"""
Relative depth estimation using Depth Anything V2 Small.
Extracts normalized depth median per bounding box and computes relative depth ranks.
"""

import io
from typing import Optional
import numpy as np
from PIL import Image

_pipe = None


def _get_pipe():
    import torch
    from transformers import pipeline
    global _pipe
    if _pipe is None:
        device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
        _pipe = pipeline(
            "depth-estimation",
            model="depth-anything/Depth-Anything-V2-Small-hf",
            device=device,
        )
    return _pipe


def depth_for_boxes(jpeg_bytes: bytes, boxes: list[list[float]]) -> list[float]:
    """
    Computes normalized relative depth for each bounding box [xmin, ymin, xmax, ymax].
    Returns list of median depths in range [0.0, 1.0], where 1.0 is closest to camera.
    """
    if not boxes:
        return []

    with Image.open(io.BytesIO(jpeg_bytes)) as pil_img:
        depth_img = _get_pipe()(pil_img)["depth"]

    d = np.asarray(depth_img, dtype=np.float32)
    d_min, d_max = float(d.min()), float(d.max())
    d_norm = (d - d_min) / (d_max - d_min + 1e-6)
    H, W = d_norm.shape

    out: list[float] = []
    for x1, y1, x2, y2 in boxes:
        # Clamp to image boundaries
        ix1 = max(0, min(W - 1, int(x1 * W)))
        iy1 = max(0, min(H - 1, int(y1 * H)))
        ix2 = max(ix1 + 1, min(W, int(x2 * W)))
        iy2 = max(iy1 + 1, min(H, int(y2 * H)))

        region = d_norm[iy1:iy2, ix1:ix2]
        if region.size == 0:
            out.append(0.0)
        else:
            out.append(round(float(np.median(region)), 3))

    return out


def rank_by_depth(depths: list[float]) -> list[int]:
    """
    Ranks depths where rank 1 is the closest object to the camera (highest depth value).
    """
    if not depths:
        return []
    sorted_indices = sorted(range(len(depths)), key=lambda i: depths[i], reverse=True)
    ranks = [0] * len(depths)
    for rank, idx in enumerate(sorted_indices, 1):
        ranks[idx] = rank
    return ranks
