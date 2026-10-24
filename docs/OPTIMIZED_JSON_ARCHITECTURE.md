# How the Optimized JSON Architecture Works

Commonplace uses a decoupled, high-speed spatial vision pipeline designed to generate structured household object memory in **real time (< 1–2 seconds)** without heavy 3D mesh rendering or WebGL HTML compilation bottlenecks.

---

## 1. End-to-End System Diagram

```
                        Input Source (Photo, Folder, or Video)
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
         Single / Multi-Photo Sequence                  Continuous Video Stream (1–2 FPS)
                 │                                               │
   [services/worker/stitching.py]                 [services/worker/stream.py]
   • OpenCV Panorama Stitch (~0.8s)              • Tier 1: Real-time loop (~150ms/frame)
                 │                                 - Frame diff motion check (0.2ms)
   [services/worker/vision.py]                     - Depth Anything V2 (145ms)
   • 1 Gemini detection pass (~3.0s)               - Local tracking & relations math (0.01ms)
                 │                               • Tier 2: Non-blocking async keyframe task
   [services/worker/depth.py]                      - Gemini + SigLIP runs in background
   • Box depth median sampling (~0.4s)                     │
                 │                                         │
   [services/worker/embedding.py]                          │
   • SigLIP crop vectors (~0.4s)                           │
                 │                                         │
   [services/worker/relations.py]                          │
   • Geometric pairwise relations (0.01ms)                 │
                 │                                         │
   [services/worker/matching.py]                           │
   • 2-stage identity resolution & EMA                     │
                 │                                         │
                 └───────────────────────┬─────────────────┘
                                         ▼
                            Standardized Spatial Memory JSON
                                         │
               ┌─────────────────────────┴─────────────────────────┐
               ▼                                                   ▼
       Export to .json (< 1 ms)                           AI Spatial Query Engine
   Structured schema with sightings,            Instant answers: "Where is the trash can?"
   bounding boxes, and relative depth.          → Room, distance, and neighbors.
```

---

## 2. Dual Ingestion Pipelines

The architecture provides two complementary ingestion paths depending on whether the input is a batch of still photos or an active continuous video stream:

### Path A: Multi-Photo Sequence with Stitching
For multi-view photographs (e.g. 5–9 overlapping photos of a room):
1. **OpenCV Panorama Stitching (`services/worker/stitching.py`)**: Stitches the photos into one wide-angle scene in ~0.8s using `cv2.Stitcher_PANORAMA` (with fallback to `cv2.Stitcher_SCANS`).
2. **Consolidated Vision Inference (`services/worker/vision.py`)**: Runs Gemini object detection **once** across the wide panorama instead of issuing 9 sequential API calls. This drops multi-frame processing time from ~16s down to ~3.8s.
3. **Depth & Embedding**: Samples box depth using Depth Anything V2 Small on Apple Silicon MPS/CUDA (~0.4s) and extracts normalized 768-dim SigLIP visual crop embeddings (~0.4s).

### Path B: Continuous Real-Time Video Stream (1–2 FPS)
For continuous video capture (or 1–2 frame-per-second camera feeds), calling a remote LLM synchronously per frame causes severe backlog queues. The pipeline decouples execution into two tiers:
1. **Tier 1 (Synchronous Fast Loop, ~150 ms / frame)**:
   - **Motion Check**: Downsampled frame differencing via OpenCV (~0.2 ms) to detect camera movement.
   - **Monocular Depth**: Depth Anything V2 estimates depth and unprojects metric distance (~145 ms).
   - **Local Tracking**: Tracks existing object bounding boxes using normalized cross-correlation template matching (~10 ms).
   - **Relations Math**: Computes relative spatial relations and zone positions (0.01 ms).
   - **Live Memory Sighting**: Appends the sighting to the active memory stack (< 1 ms).
   - **Throughput**: Sustains **~6.6 FPS**, streaming 3x faster than real-time 1–2 FPS input.
2. **Tier 2 (Non-Blocking Async Keyframe Discovery)**:
   - When a keyframe is detected (first frame, or camera turns > 25%), a background task is spawned (`asyncio.create_task`).
   - The video stream loop never blocks.
   - When Gemini returns rich labels (~1.5s later), SigLIP embeddings match and enrich tracked object labels and aliases.

---

## 3. Core Worker Modules

| Module | Purpose | Latency |
| :--- | :--- | :---: |
| [`services/worker/relations.py`](file:///Users/choionyu/Desktop/Cal_hacks_13.0/services/worker/relations.py) | Pure geometric functions (`h_zone`, `v_zone`, `gap`, `relation`, `build_relations`). Calculates `left_of`, `right_of`, `in_front_of`, `behind`, `above`, `below`. | **0.01 ms** |
| [`services/worker/depth.py`](file:///Users/choionyu/Desktop/Cal_hacks_13.0/services/worker/depth.py) | Samples median depth per bounding box with Depth Anything V2 Small (`depth-anything/Depth-Anything-V2-Small-hf`) and ranks objects by distance. | **~130–150 ms** |
| [`services/worker/embedding.py`](file:///Users/choionyu/Desktop/Cal_hacks_13.0/services/worker/embedding.py) | Vision encoder (`google/siglip-base-patch16-224`) extracting normalized 768-dimensional crop embeddings for cross-view identity matching. | **~38 ms / crop** |
| [`services/worker/matching.py`](file:///Users/choionyu/Desktop/Cal_hacks_13.0/services/worker/matching.py) | Two-stage candidate matching (Stage 1: label/alias match; Stage 2: cosine similarity > 0.75 threshold) with Exponential Moving Average (EMA) visual embedding smoothing. | **< 1 ms** |
| [`services/worker/stitching.py`](file:///Users/choionyu/Desktop/Cal_hacks_13.0/services/worker/stitching.py) | Automatically stitches multi-angle room images into a seamless wide panorama. | **~0.8–1.1 s** |
| [`services/worker/pipeline.py`](file:///Users/choionyu/Desktop/Cal_hacks_13.0/services/worker/pipeline.py) | Ingests single captures or batches and generates standardized spatial memory JSON. | **~3.5–4.5 s** |
| [`services/worker/stream.py`](file:///Users/choionyu/Desktop/Cal_hacks_13.0/services/worker/stream.py) | Real-time video stream processor and interactive spatial query reader (`query_location`). | **~150 ms / frame** |

---

## 4. Standardized Output JSON Schema

The output memory JSON is compact, persistent, and structured so AI agents can parse object locations, history, and spatial relations directly:

```json
{
  "object_id": "obj_4ea15b",
  "label": "trash can",
  "aliases": [],
  "appearance": "grey plastic bin with a white plastic liner bag",
  "owner": null,
  "updated_at": "2026-10-24T21:31:22Z",
  "current": {
    "room": "Restroom",
    "summary": "On the floor in the corner, right of the dustpan, closest object in the latest photo.",
    "sighting_id": "sight_8fa9c8"
  },
  "sightings": [
    {
      "sighting_id": "sight_8fa9c8",
      "capture_id": "cap_55ac3e",
      "room": "Restroom",
      "seen_by": "Alex",
      "timestamp": "2026-10-24T21:31:22Z",
      "photo_url": "blob://captures/capture.jpg",
      "frame_position": {
        "bbox_norm": [0.691, 0.756, 0.913, 0.992],
        "h_zone": "right",
        "v_zone": "bottom",
        "depth_value": 0.639,
        "depth_rank": 1
      },
      "relations": [
        {
          "target_label": "dustpan",
          "target_object_id": "obj_50b8fa",
          "type": "right_of",
          "description": "To the right of the dustpan."
        },
        {
          "target_label": "mop",
          "target_object_id": "obj_866dd1",
          "type": "right_of",
          "description": "To the right of the mop."
        }
      ]
    }
  ]
}
```

---

## 5. Instant AI Spatial Query Engine

The in-memory stack provides sub-millisecond lookups for conversational AI interfaces:

```python
from services.worker.stream import RealtimeStreamEngine

engine = RealtimeStreamEngine(room="Restroom")
# ... ingesting video frames ...

answer = engine.query_location("Where is the trash can?")
print(answer)
```

**Output**:
> 📍 **trash can** (*grey plastic bin with a white plastic liner bag*)  
> - **Room**: Restroom  
> - **Location**: On the floor in the corner, right of the dustpan, closest object in the latest photo (~1.6m away).  
> - **Nearby Objects**:  
>   • To the right of the dustpan  
>   • To the right of the mop  
