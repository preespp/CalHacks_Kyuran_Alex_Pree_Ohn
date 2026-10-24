"""
Geometric and spatial relation reasoning for detected bounding boxes.
Pure functions, zero machine learning models required.
"""

from typing import Any, Optional


NEAR = 0.12  # Threshold for proximity ('next to / near') in normalized coordinate space


def h_zone(bbox: list[float]) -> str:
    """Returns horizontal frame zone: 'left', 'center', or 'right'."""
    cx = (bbox[0] + bbox[2]) / 2.0
    return "left" if cx < 0.33 else "right" if cx > 0.66 else "center"


def v_zone(bbox: list[float]) -> str:
    """Returns vertical frame zone: 'top', 'middle', or 'bottom'."""
    cy = (bbox[1] + bbox[3]) / 2.0
    return "top" if cy < 0.33 else "bottom" if cy > 0.66 else "middle"


def gap(a: list[float], b: list[float]) -> float:
    """
    Computes shortest Euclidean gap between two normalized bounding boxes [x1, y1, x2, y2].
    Returns 0.0 if the boxes intersect or touch.
    """
    dx = max(b[0] - a[2], a[0] - b[2], 0.0)
    dy = max(b[1] - a[3], a[1] - b[3], 0.0)
    return float((dx**2 + dy**2) ** 0.5)


def relation(
    a: list[float],
    b: list[float],
    depth_a: float,
    depth_b: float,
    near_threshold: float = NEAR,
) -> Optional[str]:
    """
    Calculates spatial relation of box 'a' relative to box 'b'.
    Returns one of: 'in_front_of', 'behind', 'left_of', 'right_of', 'above', 'below', or None.
    Note: Depth values are normalized 0..1 where higher = closer to the camera.
    """
    g = gap(a, b)
    if g > near_threshold:
        # Boxes are too far apart to declare a direct spatial neighbor relation
        return None

    acx, bcx = (a[0] + a[2]) / 2.0, (b[0] + b[2]) / 2.0
    acy, bcy = (a[1] + a[3]) / 2.0, (b[1] + b[3]) / 2.0

    # Overlapping boxes with significant depth difference indicate front/back occlusion
    if g == 0.0 and abs(depth_a - depth_b) > 0.12:
        return "in_front_of" if depth_a > depth_b else "behind"

    # Compare horizontal vs vertical center offset
    if abs(acx - bcx) >= abs(acy - bcy):
        return "left_of" if acx < bcx else "right_of"
    else:
        # In image coords, y=0 is top, y=1 is bottom
        return "above" if acy < bcy else "below"


def describe_relation(
    a_label: str,
    b_label: str,
    rel_type: str,
    gap_val: float,
    is_closest: bool = False,
) -> str:
    """Generates natural human-readable description for UI and search summaries."""
    touching = "Immediately" if gap_val <= 0.02 else ""
    if rel_type == "left_of":
        prefix = f"{touching} to the left of the {b_label}" if touching else f"To the left of the {b_label}"
        suffix = ", nearly touching it." if touching else "."
        return f"{prefix}{suffix}"
    elif rel_type == "right_of":
        prefix = f"{touching} to the right of the {b_label}" if touching else f"To the right of the {b_label}"
        suffix = ", nearly touching it." if touching else "."
        return f"{prefix}{suffix}"
    elif rel_type == "in_front_of":
        base = f"In front of the {b_label} from the camera's view"
        return f"{base}; it was the closest object in this photo." if is_closest else f"{base}."
    elif rel_type == "behind":
        return f"Behind the {b_label} from the camera's perspective."
    elif rel_type == "above":
        return f"Positioned above the {b_label}."
    elif rel_type == "below":
        return f"Positioned below the {b_label}."
    return f"Near the {b_label}."


def build_relations(
    detections: list[Any],
    depths: list[float],
    object_ids: Optional[list[str]] = None,
) -> dict[int, list[dict[str, Any]]]:
    """
    Computes pairwise spatial relations for a list of detections and depths.
    Returns a dictionary mapping detection index -> list of relation dicts.
    """
    n = len(detections)
    if object_ids is None:
        object_ids = [f"obj_{i}" for i in range(n)]

    # Identify if any detection has rank 1 (closest)
    max_depth = max(depths) if depths else 0.0

    relations_map: dict[int, list[dict[str, Any]]] = {i: [] for i in range(n)}

    for i in range(n):
        box_a = detections[i].bbox if hasattr(detections[i], "bbox") else detections[i]["bbox"]
        label_a = detections[i].label if hasattr(detections[i], "label") else detections[i]["label"]
        dep_a = depths[i]
        is_closest_a = (dep_a == max_depth and max_depth > 0)

        for j in range(n):
            if i == j:
                continue
            box_b = detections[j].bbox if hasattr(detections[j], "bbox") else detections[j]["bbox"]
            label_b = detections[j].label if hasattr(detections[j], "label") else detections[j]["label"]
            dep_b = depths[j]

            rel = relation(box_a, box_b, dep_a, dep_b)
            if rel is not None:
                g = gap(box_a, box_b)
                desc = describe_relation(label_a, label_b, rel, g, is_closest=is_closest_a)
                relations_map[i].append({
                    "target_label": label_b,
                    "target_object_id": object_ids[j],
                    "type": rel,
                    "description": desc,
                })

    return relations_map
