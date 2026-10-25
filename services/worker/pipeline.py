"""
Vision worker pipeline coordinating detection, relative depth, geometric relations,
visual embedding, and multi-view identity resolution into structured object memory.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import secrets
from typing import Any, Optional
from collections import Counter
from starlette.concurrency import run_in_threadpool
import numpy as np

from commonplace_api.config import Settings
from commonplace_api.vision import detect, normalize_image
from .depth import depth_for_boxes, rank_by_depth
from .embedding import embed_crop
from .matching import TrackedObject, create_object, find_match
from .relations import build_relations, h_zone, v_zone


@dataclass
class CaptureInput:
    raw_bytes: bytes
    room: str = "Living room"
    capture_id: str = field(default_factory=lambda: f"cap_{secrets.token_hex(3)}")
    photo_url: Optional[str] = None
    household_id: str = "demo-home"
    timestamp: Optional[str] = None
    normalized: bool = False


def generate_sighting_summary(
    label: str,
    room: str,
    location_desc: str,
    relations: list[dict[str, Any]],
    depth_rank: int,
) -> str:
    """Produces a coherent, natural summary sentence for the current object state."""
    parts = []
    # Location context from Gemini
    if location_desc:
        clean_loc = location_desc.strip().rstrip(".")
        parts.append(clean_loc[0].upper() + clean_loc[1:])
    else:
        parts.append(f"In the {room}")

    # Top relation if available
    if relations:
        top_rel = relations[0]
        parts.append(top_rel["type"].replace("_", " ") + " the " + top_rel["target_label"])

    # Rank context
    if depth_rank == 1:
        parts.append("closest object in the latest photo")

    return ", ".join(parts) + "."


async def process_capture(
    settings: Settings,
    capture: CaptureInput,
    existing_objects: Optional[list[TrackedObject]] = None,
) -> list[dict[str, Any]]:
    """
    Main worker entry point:
    1. Normalizes image.
    2. Runs Gemini 2D Object Detection.
    3. Computes relative depth for each bounding box with Depth Anything V2.
    4. Computes pairwise spatial relations and frame zones.
    5. Extracts SigLIP crop embeddings for each detection.
    6. Matches candidates against existing household object identities or spawns new ones.
    7. Produces standardized object memory JSON.
    """
    if existing_objects is None:
        existing_objects = []

    timestamp = capture.timestamp or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    # Step 1: Normalize Image
    image = capture.raw_bytes if capture.normalized else normalize_image(capture.raw_bytes)

    # Step 2: Gemini 2D Object Detection
    detections = await detect(settings, image, capture.room)
    if not detections:
        return []

    # Step 3: Depth Anything V2 Box Sampling
    boxes = [d.bbox for d in detections]
    use_models = settings.vision_enrichment == "models"
    depths = await run_in_threadpool(depth_for_boxes, image, boxes) if use_models else [0.0] * len(boxes)
    ranks = rank_by_depth(depths) if use_models else [None] * len(boxes)
    signatures = Counter((d.label.casefold(), d.appearance.casefold()) for d in detections)

    # Step 4: Extract visual crop embeddings & resolve identities across multi-view sequence
    assigned_objects: list[TrackedObject] = []
    crop_embeddings: list[list[float]] = []
    claimed_in_this_frame: set[str] = set()

    for det in detections:
        emb = await run_in_threadpool(embed_crop, image, det.bbox) if use_models else []
        crop_embeddings.append(emb)

        # Candidates: existing objects not already claimed in this specific frame
        candidates = [obj for obj in existing_objects if obj.object_id not in claimed_in_this_frame]
        if use_models:
            matched = find_match(emb, det.label, candidates)
        else:
            # Conservative metadata association when optional local ML models
            # aren't installed. Never choose between identical-looking objects.
            matches = [o for o in candidates if o.label.casefold() == det.label.casefold()
                       and o.appearance.casefold() == det.appearance.casefold() and det.appearance.strip()]
            matched = matches[0] if len(matches) == 1 and signatures[(det.label.casefold(), det.appearance.casefold())] == 1 else None

        if matched is None:
            new_obj = create_object(
                label=det.label,
                appearance=det.appearance,
                embedding=emb,
            )
            existing_objects.append(new_obj)
            matched = new_obj
        elif use_models:
            # Smooth embedding with exponential moving average across camera views
            old_v = np.array(matched.embedding, dtype=np.float32)
            new_v = np.array(emb, dtype=np.float32)
            smoothed = 0.7 * old_v + 0.3 * new_v
            norm = float(np.linalg.norm(smoothed))
            if norm > 0:
                matched.embedding = [round(float(x), 5) for x in (smoothed / norm)]
            if det.appearance and len(det.appearance) > len(matched.appearance):
                matched.appearance = det.appearance

        claimed_in_this_frame.add(matched.object_id)
        assigned_objects.append(matched)

    # Step 5: Build Pairwise Spatial Relations
    obj_ids = [obj.object_id for obj in assigned_objects]
    relations_map = build_relations(detections, depths, object_ids=obj_ids)

    # Step 6: Construct Sightings & Update Object States
    for i, (det, dep, rank, obj) in enumerate(zip(detections, depths, ranks, assigned_objects)):
        sighting_id = f"sight_{secrets.token_hex(3)}"
        obj_rels = relations_map.get(i, [])

        summary = generate_sighting_summary(
            label=det.label,
            room=capture.room,
            location_desc=det.location,
            relations=obj_rels,
            depth_rank=rank,
        )

        sighting = {
            "sighting_id": sighting_id,
            "capture_id": capture.capture_id,
            "room": capture.room,
            "timestamp": timestamp,
            "photo_url": capture.photo_url,
            "frame_position": {
                "bbox_norm": [round(float(c), 3) for c in det.bbox],
                "h_zone": h_zone(det.bbox),
                "v_zone": v_zone(det.bbox),
                "depth_value": round(float(dep), 3) if use_models else None,
                "depth_rank": rank,
            },
            "relations": obj_rels,
        }

        obj.current = {
            "room": capture.room,
            "summary": summary,
            "sighting_id": sighting_id,
        }
        obj.sightings = [sighting]  # Durable history is stored in object_sighting.
        obj.updated_at = timestamp

    # Return distinct tracked objects formatted as dictionary payloads
    # (preserve order of unique objects)
    unique_objects = []
    seen_ids = set()
    for obj in assigned_objects:
        if obj.object_id not in seen_ids:
            seen_ids.add(obj.object_id)
            unique_objects.append({**obj.to_dict(), "embedding": obj.embedding})

    return unique_objects
