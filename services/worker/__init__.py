"""
Commonplace Worker Package.
Modular spatial perception, relative depth, relational reasoning, and object memory.
"""

from .depth import depth_for_boxes, rank_by_depth
from .embedding import embed_crop
from .matching import TrackedObject, cosine, create_object, find_match
from .pipeline import CaptureInput, process_capture
from .relations import build_relations, gap, h_zone, relation, v_zone
from .stitching import stitch_images
from .vision import Settings, detect, normalize_image

__all__ = [
    "Settings",
    "detect",
    "normalize_image",
    "stitch_images",
    "depth_for_boxes",
    "rank_by_depth",
    "h_zone",
    "v_zone",
    "gap",
    "relation",
    "build_relations",
    "embed_crop",
    "cosine",
    "find_match",
    "create_object",
    "TrackedObject",
    "CaptureInput",
    "process_capture",
]
