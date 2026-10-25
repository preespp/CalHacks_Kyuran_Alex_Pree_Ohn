"""
Object matching and multi-view identity resolution.
Performs semantic label filtering and SigLIP visual embedding cosine similarity matching.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import secrets
from typing import Any, Optional


def cosine(a: list[float], b: list[float]) -> float:
    """Computes cosine similarity between two vectors (dot product if unit-normalized)."""
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    # If already unit vectors, dot is cosine similarity
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return float(dot / (norm_a * norm_b))


@dataclass
class TrackedObject:
    object_id: str
    label: str
    appearance: str
    embedding: list[float]
    aliases: list[str] = field(default_factory=list)
    owner: Optional[str] = None
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))
    current: dict[str, Any] = field(default_factory=dict)
    sightings: list[dict[str, Any]] = field(default_factory=list)

    @property
    def labels_and_aliases(self) -> set[str]:
        all_names = {self.label.lower()}
        for a in self.aliases:
            all_names.add(a.lower())
        return all_names

    def to_dict(self) -> dict[str, Any]:
        return {
            "object_id": self.object_id,
            "label": self.label,
            "aliases": self.aliases,
            "appearance": self.appearance,
            "owner": self.owner,
            "updated_at": self.updated_at,
            "current": self.current,
            "sightings": self.sightings,
        }


def find_match(
    new_emb: list[float],
    new_label: str,
    existing: list[TrackedObject],
    threshold: float = 0.80,
) -> Optional[TrackedObject]:
    """
    Finds the best matching existing object:
    1. Filter: Candidate must share label or alias (case-insensitive substring/equality).
    2. Visual Appearance: Max cosine similarity above the threshold.
    """
    best: Optional[TrackedObject] = None
    best_score = threshold
    nl = new_label.lower().strip()

    for obj in existing:
        # Check label or alias membership
        names = obj.labels_and_aliases
        label_match = (
            nl in names
            or any(nl in n or n in nl for n in names)
        )
        if not label_match:
            continue

        score = cosine(new_emb, obj.embedding)
        if score > best_score:
            best, best_score = obj, score

    return best


def create_object(
    label: str,
    appearance: str,
    embedding: list[float],
    aliases: Optional[list[str]] = None,
    owner: Optional[str] = None,
) -> TrackedObject:
    """Instantiates a new unique tracked household object."""
    obj_id = f"obj_{secrets.token_hex(12)}"
    return TrackedObject(
        object_id=obj_id,
        label=label,
        appearance=appearance,
        embedding=embedding,
        aliases=aliases or [],
        owner=owner,
    )
