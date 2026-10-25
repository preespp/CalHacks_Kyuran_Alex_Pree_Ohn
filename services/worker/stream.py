"""
Real-time Video Stream Processor & Persistent Spatial Memory Engine.
Designed for 1-2 FPS continuous video feeds with sub-250ms per-frame execution.

Architecture:
- Tier 1 (Synchronous, ~150-200ms): Fast Motion Filter + Depth Anything V2 + Local Tracker + Geometric Relations + Memory Stack.
- Tier 2 (Asynchronous, non-blocking): Keyframe Semantic Discovery via Gemini API + SigLIP Visual Association.
- Tier 3: Instant Spatial Memory Query Engine ("Where is X?").
"""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
import io
import json
import secrets
import time
from typing import Any, Dict, List, Optional, Tuple
import cv2
import numpy as np
from PIL import Image

from commonplace_api.config import Settings
from commonplace_api.models import Detection
from commonplace_api.vision import detect, normalize_image
from .depth import _get_pipe, depth_for_boxes, rank_by_depth
from .embedding import embed_crop
from .matching import TrackedObject, create_object, find_match
from .relations import build_relations, h_zone, v_zone


@dataclass
class FrameLatency:
    motion_check_ms: float = 0.0
    depth_ms: float = 0.0
    tracking_ms: float = 0.0
    relations_ms: float = 0.0
    memory_ms: float = 0.0
    total_ms: float = 0.0
    is_keyframe: bool = False
    async_gemini_launched: bool = False


@dataclass
class ActiveTrack:
    object_id: str
    label: str
    bbox: list[float]  # [x1, y1, x2, y2] normalized
    depth: float = 0.5
    last_patch: Optional[np.ndarray] = None
    frames_unseen: int = 0


class RealtimeStreamEngine:
    def __init__(self, room: str = "Living room", household_id: str = "house_default"):
        self.room = room
        self.household_id = household_id
        self.objects: dict[str, TrackedObject] = {}
        self.active_tracks: list[ActiveTrack] = []
        
        self.last_gray_frame: Optional[np.ndarray] = None
        self.frame_index: int = 0
        self.last_keyframe_idx: int = -999
        self.keyframe_interval: int = 10  # Fallback keyframe every N frames
        self.motion_threshold: float = 0.25  # Trigger keyframe if camera turns significantly
        
        # Async background task holder
        self._bg_tasks: set[asyncio.Task] = set()
        
        # Settings for vision adapter
        self.settings = Settings.from_env()

    def _compute_motion_score(self, cv_frame: np.ndarray) -> float:
        """Computes fast downsampled frame difference (takes ~2ms)."""
        small_gray = cv2.cvtColor(cv2.resize(cv_frame, (160, 120)), cv2.COLOR_BGR2GRAY)
        if self.last_gray_frame is None:
            self.last_gray_frame = small_gray
            return 1.0  # First frame is 100% new
        diff = cv2.absdiff(self.last_gray_frame, small_gray)
        score = float(np.mean(diff) / 255.0)
        self.last_gray_frame = small_gray
        return score

    def _track_active_boxes(self, cv_frame: np.ndarray) -> None:
        """
        Fast local template/region tracking for existing objects (takes ~15-30ms total).
        Updates active bounding boxes without calling an external API.
        """
        H, W = cv_frame.shape[:2]
        updated_tracks = []
        search_pad = 40

        for trk in self.active_tracks:
            x1, y1, x2, y2 = [
                int(trk.bbox[0] * W),
                int(trk.bbox[1] * H),
                int(trk.bbox[2] * W),
                int(trk.bbox[3] * H),
            ]
            bw, bh = max(8, x2 - x1), max(8, y2 - y1)

            if trk.last_patch is None:
                # Capture initial patch
                patch = cv_frame[max(0, y1):min(H, y2), max(0, x1):min(W, x2)]
                if patch.size > 0:
                    trk.last_patch = cv2.resize(patch, (48, 48))
                updated_tracks.append(trk)
                continue

            # Local search window around previous location
            sy1, sx1 = max(0, y1 - search_pad), max(0, x1 - search_pad)
            sy2, sx2 = min(H, y2 + search_pad), min(W, x2 + search_pad)
            search_area = cv_frame[sy1:sy2, sx1:sx2]

            if search_area.shape[0] < trk.last_patch.shape[0] or search_area.shape[1] < trk.last_patch.shape[1]:
                trk.frames_unseen += 1
                if trk.frames_unseen < 6:
                    updated_tracks.append(trk)
                continue

            # Normalized cross-correlation
            res = cv2.matchTemplate(search_area, trk.last_patch, cv2.TM_CCOEFF_NORMED)
            _, max_val, _, max_loc = cv2.minMaxLoc(res)

            if max_val > 0.40:
                # Track confirmed
                new_x1 = sx1 + max_loc[0]
                new_y1 = sy1 + max_loc[1]
                new_x2 = min(W, new_x1 + bw)
                new_y2 = min(H, new_y1 + bh)

                trk.bbox = [
                    round(float(new_x1 / W), 3),
                    round(float(new_y1 / H), 3),
                    round(float(new_x2 / W), 3),
                    round(float(new_y2 / H), 3),
                ]
                # Refresh patch
                new_patch = cv_frame[new_y1:new_y2, new_x1:new_x2]
                if new_patch.size > 0:
                    trk.last_patch = cv2.resize(new_patch, (48, 48))
                trk.frames_unseen = 0
                updated_tracks.append(trk)
            else:
                trk.frames_unseen += 1
                if trk.frames_unseen < 6:
                    updated_tracks.append(trk)

        self.active_tracks = updated_tracks

    async def _async_keyframe_discovery(self, image_bytes: bytes, frame_time: str, capture_id: str):
        """
        Background semantic discovery using Gemini API.
        Executes without blocking the 1-2 FPS real-time ingestion loop!
        """
        try:
            detections = await detect(self.settings, image_bytes, self.room)
            if not detections:
                return

            # SigLIP visual embeddings for newly detected objects
            for det in detections:
                emb = embed_crop(image_bytes, det.bbox)
                matched = find_match(emb, det.label, list(self.objects.values()))

                sighting_id = f"sight_{secrets.token_hex(3)}"
                hz = h_zone(det.bbox)
                vz = v_zone(det.bbox)
                loc_desc = det.location if det.location else f"on the {hz} side"
                summary = f"In the {self.room}, {loc_desc} ({hz} of view)."

                if matched is None:
                    # New household object
                    matched = create_object(
                        label=det.label,
                        appearance=det.appearance,
                        embedding=emb,
                    )
                    matched.current = {
                        "room": self.room,
                        "summary": summary,
                        "sighting_id": sighting_id,
                    }
                    matched.sightings.append({
                        "sighting_id": sighting_id,
                        "capture_id": capture_id,
                        "room": self.room,
                        "timestamp": frame_time,
                        "frame_position": {
                            "bbox_norm": det.bbox,
                            "h_zone": hz,
                            "v_zone": vz,
                            "depth_value": 0.5,
                            "depth_rank": 1,
                        },
                        "relations": [],
                    })
                    matched.updated_at = frame_time
                    self.objects[matched.object_id] = matched

                    # Add to active tracking list
                    self.active_tracks.append(ActiveTrack(
                        object_id=matched.object_id,
                        label=matched.label,
                        bbox=det.bbox,
                    ))
                else:
                    # Enrich existing object representation
                    if det.appearance and len(det.appearance) > len(matched.appearance):
                        matched.appearance = det.appearance
                    if det.label not in matched.labels_and_aliases:
                        matched.aliases.append(det.label)
                    if not matched.current or matched.current.get("summary") == "Location unknown":
                        matched.current = {
                            "room": self.room,
                            "summary": summary,
                            "sighting_id": sighting_id,
                        }
                    matched.updated_at = frame_time

                    # Ensure it is actively tracked
                    if not any(t.object_id == matched.object_id for t in self.active_tracks):
                        self.active_tracks.append(ActiveTrack(
                            object_id=matched.object_id,
                            label=matched.label,
                            bbox=det.bbox,
                        ))
        except Exception as e:
            # Non-fatal background error
            pass

    async def ingest_frame(
        self,
        raw_bytes: bytes,
        timestamp: Optional[str] = None,
        force_keyframe: bool = False,
    ) -> Tuple[dict, FrameLatency]:
        """
        Processes a single incoming video frame in REAL TIME (< 250ms).
        - Runs local depth and tracking synchronously.
        - Offloads semantic discovery to a non-blocking background task when needed.
        """
        t_start = time.perf_counter()
        lat = FrameLatency()
        self.frame_index += 1
        now_str = timestamp or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        cap_id = f"frame_{self.frame_index:04d}"

        # Decode cv2 image for fast computer vision operations
        nparr = np.frombuffer(raw_bytes, np.uint8)
        cv_frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if cv_frame is None:
            raise ValueError("Failed to decode frame buffer")

        # 1. Motion Differencing (< 3ms)
        t0 = time.perf_counter()
        motion = self._compute_motion_score(cv_frame)
        lat.motion_check_ms = (time.perf_counter() - t0) * 1000

        # Decide if this frame requires keyframe semantic discovery
        is_keyframe = (
            force_keyframe
            or self.frame_index == 1
            or motion > self.motion_threshold
            or (self.frame_index - self.last_keyframe_idx) >= self.keyframe_interval
        )
        lat.is_keyframe = is_keyframe

        # 2. Local Depth Map Estimation (~130ms on MPS)
        t0 = time.perf_counter()
        # Resize to standard 518x518 for Depth Anything V2
        pil_img = Image.fromarray(cv2.cvtColor(cv_frame, cv2.COLOR_BGR2RGB))
        depth_pipe = _get_pipe()
        depth_res = depth_pipe(pil_img)["depth"]
        d_np = np.asarray(depth_res, dtype=np.float32)
        d_norm = (d_np - d_np.min()) / (d_np.max() - d_np.min() + 1e-6)
        H_d, W_d = d_norm.shape
        lat.depth_ms = (time.perf_counter() - t0) * 1000

        # 3. Local Object Tracking (< 25ms)
        t0 = time.perf_counter()
        self._track_active_boxes(cv_frame)
        
        # Sample depths for currently tracked objects
        for trk in self.active_tracks:
            x1, y1, x2, y2 = trk.bbox
            rx1 = max(0, min(W_d - 1, int(x1 * W_d)))
            ry1 = max(0, min(H_d - 1, int(y1 * H_d)))
            rx2 = max(rx1 + 1, min(W_d, int(x2 * W_d)))
            ry2 = max(ry1 + 1, min(H_d, int(y2 * H_d)))
            region = d_norm[ry1:ry2, rx1:rx2]
            trk.depth = float(np.median(region)) if region.size > 0 else 0.5
        lat.tracking_ms = (time.perf_counter() - t0) * 1000

        # 4. Pairwise Geometric Relations (< 1ms)
        t0 = time.perf_counter()
        frame_detections = []
        for trk in self.active_tracks:
            x1, y1, x2, y2 = trk.bbox
            cx1, cy1 = max(0.0, min(0.98, float(x1))), max(0.0, min(0.98, float(y1)))
            cx2, cy2 = max(cx1 + 0.01, min(1.0, float(x2))), max(cy1 + 0.01, min(1.0, float(y2)))
            frame_detections.append(Detection(
                label=trk.label or "object",
                appearance=trk.label or "object",
                location=f"in {self.room}",
                bbox=[cx1, cy1, cx2, cy2],
            ))
        depths = [trk.depth for trk in self.active_tracks]
        obj_ids = [trk.object_id for trk in self.active_tracks]
        ranks = rank_by_depth(depths)
        relations_map = build_relations(frame_detections, depths, object_ids=obj_ids)
        lat.relations_ms = (time.perf_counter() - t0) * 1000

        # 5. Update Memory Sightings & Current States (< 1ms)
        t0 = time.perf_counter()
        sighting_records = []
        for i, (trk, rank) in enumerate(zip(self.active_tracks, ranks)):
            obj = self.objects.get(trk.object_id)
            if not obj:
                continue

            obj_rels = relations_map.get(i, [])
            sight_id = f"sight_{secrets.token_hex(3)}"
            
            # Monocular relative depth has no calibrated metric scale.

            rel_text = ""
            if obj_rels:
                rel_text = f", {obj_rels[0]['type'].replace('_', ' ')} the {obj_rels[0]['target_label']}"

            summary = f"In the {self.room}{rel_text}, {h_zone(trk.bbox)} side of this photo (relative depth rank {rank})."

            sighting = {
                "sighting_id": sight_id,
                "capture_id": cap_id,
                "room": self.room,
                "timestamp": now_str,
                "frame_position": {
                    "bbox_norm": trk.bbox,
                    "h_zone": h_zone(trk.bbox),
                    "v_zone": v_zone(trk.bbox),
                    "depth_value": round(trk.depth, 3),
                    "depth_rank": rank,
                },
                "relations": obj_rels,
            }
            obj.current = {
                "room": self.room,
                "summary": summary,
                "sighting_id": sight_id,
            }
            obj.sightings.append(sighting)
            obj.updated_at = now_str
            sighting_records.append({"label": trk.label, "depth_rank": rank, "bbox": trk.bbox})
        lat.memory_ms = (time.perf_counter() - t0) * 1000

        # 6. Dispatch Asynchronous Keyframe Discovery (Non-blocking!)
        if is_keyframe:
            self.last_keyframe_idx = self.frame_index
            norm_jpeg = normalize_image(raw_bytes)
            # Create background task that runs independently
            task = asyncio.create_task(
                self._async_keyframe_discovery(norm_jpeg, now_str, cap_id)
            )
            self._bg_tasks.add(task)
            task.add_done_callback(self._bg_tasks.discard)
            lat.async_gemini_launched = True

        lat.total_ms = (time.perf_counter() - t_start) * 1000

        frame_summary = {
            "frame_index": self.frame_index,
            "capture_id": cap_id,
            "motion_score": round(motion, 4),
            "is_keyframe": is_keyframe,
            "active_tracked_objects": len(self.active_tracks),
            "total_objects_in_memory": len(self.objects),
            "sightings": sighting_records,
        }

        return frame_summary, lat

    def query_location(self, query: str) -> str:
        """
        AI Spatial Memory Reader:
        Answers where any object is located using current memory and neighbor relations.
        """
        query_norm = query.lower().strip()
        best_obj = None

        # 1. Search by label or alias
        for obj in self.objects.values():
            if query_norm in obj.label.lower() or any(query_norm in a.lower() for a in obj.aliases):
                best_obj = obj
                break

        # 2. Search by appearance description
        if not best_obj:
            for obj in self.objects.values():
                if query_norm in obj.appearance.lower():
                    best_obj = obj
                    break

        # 3. Token-based word overlap match (e.g. "potted plant" -> matches "artificial plant", "broom" -> "yellow handle broom")
        if not best_obj:
            query_words = set(w for w in query_norm.split() if len(w) > 2)
            best_score = 0
            for obj in self.objects.values():
                haystack = f"{obj.label.lower()} {obj.appearance.lower()} {' '.join(obj.aliases).lower()}"
                score = sum(1 for w in query_words if w in haystack)
                if score > best_score:
                    best_score = score
                    best_obj = obj

        if not best_obj:
            available = [o.label for o in self.objects.values()]
            return f"I couldn't find '{query}' in memory. Currently tracked objects: {', '.join(available) if available else 'None'}."

        curr = best_obj.current or {}
        summary = curr.get("summary", "Location unknown")
        dist = curr.get("distance_meters")
        dist_str = f" (~{dist}m away)" if dist else ""

        # Latest sighting details
        latest_sighting = best_obj.sightings[-1] if best_obj.sightings else None
        rel_lines = []
        if latest_sighting:
            for r in latest_sighting.get("relations", []):
                rel_lines.append(f"• {r.get('description', r['type'] + ' ' + r['target_label'])}")

        answer = [
            f"📍 **{best_obj.label}** ({best_obj.appearance})",
            f"- **Room**: {curr.get('room', self.room)}",
            f"- **Location**: {summary}{dist_str}",
            f"- **Last Updated**: {best_obj.updated_at}",
        ]
        if rel_lines:
            answer.append("- **Nearby Objects**:\n  " + "\n  ".join(rel_lines))

        return "\n".join(answer)

    def export_memory_json(self) -> list[dict]:
        """Returns the full tracked memory in standardized JSON format."""
        return [o.to_dict() for o in self.objects.values()]
