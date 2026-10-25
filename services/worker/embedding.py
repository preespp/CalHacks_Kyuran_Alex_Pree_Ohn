"""
Visual crop embedding generation using SigLIP (google/siglip-base-patch16-224).
Takes an image and normalized bounding box, crops the region, and produces a normalized unit embedding.
"""

import io
from typing import Optional
import numpy as np
from PIL import Image

_processor = None
_model = None
_device = None

MODEL_ID = "google/siglip-base-patch16-224"


def _get_embedding_components():
    import torch
    from transformers import AutoImageProcessor, SiglipVisionModel, logging as hf_logging
    global _processor, _model, _device
    if _model is None:
        _device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
        prev_verbosity = hf_logging.get_verbosity()
        try:
            hf_logging.set_verbosity_error()
            _processor = AutoImageProcessor.from_pretrained(MODEL_ID)
            _model = SiglipVisionModel.from_pretrained(MODEL_ID).to(_device)
            _model.eval()
        finally:
            hf_logging.set_verbosity(prev_verbosity)
    return _processor, _model, _device


def embed_crop(jpeg_bytes: bytes, bbox: list[float]) -> list[float]:
    """
    Crops the object bounding box [x1, y1, x2, y2] from the image and extracts
    an L2-normalized 768-dimensional SigLIP visual embedding vector.
    """
    import torch
    processor, model, device = _get_embedding_components()

    with Image.open(io.BytesIO(jpeg_bytes)) as pil_img:
        w, h = pil_img.size
        x1, y1, x2, y2 = bbox

        # Convert normalized coordinates to pixel bounding box
        px1 = max(0, min(w - 1, int(x1 * w)))
        py1 = max(0, min(h - 1, int(y1 * h)))
        px2 = max(px1 + 4, min(w, int(x2 * w)))
        py2 = max(py1 + 4, min(h, int(y2 * h)))

        crop = pil_img.crop((px1, py1, px2, py2)).convert("RGB")

    inputs = processor(images=crop, return_tensors="pt").to(device)
    with torch.no_grad():
        outputs = model(**inputs)
        # Use pooler output or mean of last hidden state
        emb = outputs.pooler_output
        if emb is None:
            emb = outputs.last_hidden_state.mean(dim=1)
        # L2-normalize to unit hypersphere
        emb = emb / emb.norm(p=2, dim=-1, keepdim=True)
        vec = emb.squeeze(0).cpu().tolist()

    return [round(float(v), 5) for v in vec]
