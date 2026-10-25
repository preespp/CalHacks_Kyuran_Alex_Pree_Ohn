"""
Depth Estimation using Depth-Anything-V2-Small-hf.
Extracts depth maps and computes relative depth for detected object bounding boxes.
"""

import io
from typing import Any
import numpy as np
import torch
from PIL import Image
from transformers import pipeline

_pipe = None


def get_depth_pipeline():
    """Lazily load and cache the Depth-Anything-V2-Small pipeline on Apple MPS or CPU."""
    global _pipe
    if _pipe is None:
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        _pipe = pipeline(
            "depth-estimation",
            model="depth-anything/Depth-Anything-V2-Small-hf",
            device=device,
        )
    return _pipe


def estimate_depth(image_bytes: bytes) -> dict[str, Any]:
    """
    Given normalized JPEG/PNG image bytes:
    Returns:
        depth_pil: PIL Image of the depth map (mode 'L')
        depth_array: float32 numpy array (0.0 to 1.0, where 1.0 = closest, 0.0 = farthest)
    """
    pipe = get_depth_pipeline()
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    
    result = pipe(image)
    depth_pil = result["depth"]
    
    # Ensure depth map matches image dimensions
    if depth_pil.size != image.size:
        depth_pil = depth_pil.resize(image.size, Image.Resampling.BILINEAR)
        
    raw_arr = np.array(depth_pil, dtype=np.float32)
    # Normalize to 0.0 - 1.0 (Depth Anything: 255 = closest foreground, 0 = farthest background)
    norm_arr = raw_arr / 255.0

    return {
        "depth_pil": depth_pil,
        "depth_array": norm_arr,  # 0.0 (far) to 1.0 (near)
        "width": image.width,
        "height": image.height,
    }


def compute_relative_depth(depth_array: np.ndarray, bbox: list[float]) -> dict[str, float]:
    """
    Extracts depth statistics from bbox = [xmin, ymin, xmax, ymax] (normalized 0.0 to 1.0).
    Uses the inner 60% region of the box to avoid background boundary bleeding.
    """
    h, w = depth_array.shape[:2]
    xmin, ymin, xmax, ymax = bbox
    
    x1 = max(0, min(w - 1, int(xmin * w)))
    y1 = max(0, min(h - 1, int(ymin * h)))
    x2 = max(x1 + 1, min(w, int(xmax * w)))
    y2 = max(y1 + 1, min(h, int(ymax * h)))

    crop = depth_array[y1:y2, x1:x2]
    if crop.size == 0:
        return {"relative_depth": 0.0, "median": 0.0, "mean": 0.0}

    # Focus on the inner 60% of the bounding box to capture the object surface rather than table/wall
    box_w = x2 - x1
    box_h = y2 - y1
    pad_w = int(0.2 * box_w)
    pad_h = int(0.2 * box_h)
    
    inner_crop = crop[pad_h : box_h - pad_h, pad_w : box_w - pad_w]
    target_crop = inner_crop if inner_crop.size > 0 else crop

    median_val = float(np.median(target_crop))
    mean_val = float(np.mean(target_crop))

    return {
        "relative_depth": round(median_val, 3),  # 1.0 = closest, 0.0 = farthest
        "mean_depth": round(mean_val, 3),
    }


def colorize_depth_map(depth_array: np.ndarray) -> Image.Image:
    """Colorizes depth array using inferno colormap for clear human inspection."""
    import matplotlib
    colormap = matplotlib.colormaps["inferno"]
    colored = colormap(depth_array)[:, :, :3]  # drop alpha
    colored_uint8 = (colored * 255).astype(np.uint8)
    return Image.fromarray(colored_uint8)
