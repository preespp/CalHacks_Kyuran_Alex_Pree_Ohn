"""
Fast JSON-Only Spatial Memory Generator (No 3D mapping, No HTML).
Directly extracts structured household object memory in the target JSON schema.

Supports:
- Single image (e.g. 'can coffee.jpeg')
- Image directory (e.g. 'images2' / 'images') with optional fast stitching
- Video file (e.g. 'restroom.mp4') at 2 FPS stream rate
"""

import argparse
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time
import cv2

from commonplace_api.config import Settings
from services.worker.pipeline import CaptureInput, process_capture
from services.worker.stitching import stitch_images
from services.worker.stream import RealtimeStreamEngine
from services.worker.depth import _get_pipe
from services.worker.embedding import _get_embedding_components


async def run_single_image(image_path: Path, room: str, output_json: Path):
    settings = Settings.from_env()
    raw = image_path.read_bytes()
    now_str = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    cap = CaptureInput(raw_bytes=raw, room=room, timestamp=now_str)

    t0 = time.perf_counter()
    objects = await process_capture(settings, cap)
    elapsed = time.perf_counter() - t0

    json_str = json.dumps(objects, indent=2)
    output_json.write_text(json_str)

    print("=" * 70)
    print("JSON-ONLY GENERATION RESULT (SINGLE IMAGE)")
    print("=" * 70)
    print(f"• Input Image      : {image_path.name}")
    print(f"• Room Context     : {room}")
    print(f"• Objects Detected : {len(objects)}")
    print(f"• Pure JSON Time   : {elapsed:.2f} seconds")
    print(f"• JSON Saved To    : {output_json.name} ({len(json_str.encode('utf-8')) / 1024:.1f} KB)")
    print("=" * 70)
    return objects


async def run_image_folder(dir_path: Path, room: str, output_json: Path, use_stitch: bool = True):
    settings = Settings.from_env()
    img_files = sorted(list(dir_path.glob("*.jpg")) + list(dir_path.glob("*.png")) + list(dir_path.glob("*.jpeg")))
    if not img_files:
        print(f"Error: No images found in {dir_path}")
        return []

    t0 = time.perf_counter()
    if use_stitch and len(img_files) > 1:
        # Fast stitched panorama -> single-pass detection
        raw_list = [f.read_bytes() for f in img_files]
        t_stitch_0 = time.perf_counter()
        success, pano_bytes, method = stitch_images(raw_list)
        t_stitch = time.perf_counter() - t_stitch_0

        if not success or pano_bytes is None:
            print(f"Stitching failed ({method}), falling back to first image.")
            pano_bytes = raw_list[0]

        now_str = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        cap = CaptureInput(raw_bytes=pano_bytes, room=room, timestamp=now_str)
        objects = await process_capture(settings, cap)
    else:
        # Sequential processing
        existing = []
        objects = []
        for f in img_files:
            cap = CaptureInput(raw_bytes=f.read_bytes(), room=room)
            objects = await process_capture(settings, cap, existing_objects=existing)

    elapsed = time.perf_counter() - t0
    json_str = json.dumps(objects, indent=2)
    output_json.write_text(json_str)

    print("=" * 70)
    print("JSON-ONLY GENERATION RESULT (IMAGE SEQUENCE)")
    print("=" * 70)
    print(f"• Input Directory  : {dir_path.name} ({len(img_files)} frames)")
    print(f"• Room Context     : {room}")
    print(f"• Objects Tracked  : {len(objects)}")
    print(f"• Pure JSON Time   : {elapsed:.2f} seconds")
    print(f"• JSON Saved To    : {output_json.name} ({len(json_str.encode('utf-8')) / 1024:.1f} KB)")
    print("=" * 70)
    return objects


async def run_video(video_path: Path, room: str, output_json: Path, target_fps: float = 2.0):
    cap = cv2.VideoCapture(str(video_path))
    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / native_fps
    frame_step = max(1, int(round(native_fps / target_fps)))

    engine = RealtimeStreamEngine(room=room)
    frame_idx = 0
    sampled_count = 0

    t0 = time.perf_counter()
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % frame_step == 0:
            sampled_count += 1
            ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            if ok:
                now_str = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                await engine.ingest_frame(raw_bytes=buf.tobytes(), timestamp=now_str)
            await asyncio.sleep(0.005)

        frame_idx += 1

    cap.release()

    if engine._bg_tasks:
        await asyncio.gather(*list(engine._bg_tasks), return_exceptions=True)

    elapsed = time.perf_counter() - t0
    objects = engine.export_memory_json()
    json_str = json.dumps(objects, indent=2)
    output_json.write_text(json_str)

    print("=" * 70)
    print("JSON-ONLY GENERATION RESULT (VIDEO STREAM)")
    print("=" * 70)
    print(f"• Input Video      : {video_path.name} ({duration:.1f}s)")
    print(f"• Sampled Frames   : {sampled_count} frames (at {target_fps} FPS)")
    print(f"• Room Context     : {room}")
    print(f"• Objects Tracked  : {len(objects)}")
    print(f"• Total Stream Time: {elapsed:.2f} seconds ({elapsed/sampled_count*1000:.1f} ms/frame)")
    print(f"• JSON Saved To    : {output_json.name} ({len(json_str.encode('utf-8')) / 1024:.1f} KB)")
    print("=" * 70)
    return objects


async def main():
    parser = argparse.ArgumentParser(description="Generate spatial object JSON without HTML/3D mapping.")
    parser.add_argument("input", nargs="?", default="images2", help="Image file, folder, or video file")
    parser.add_argument("--room", "-r", default="Restroom", help="Room name context (default: Restroom)")
    parser.add_argument("--output", "-o", default=None, help="Output JSON path")
    parser.add_argument("--fps", type=float, default=2.0, help="Target FPS for video ingestion")
    args = parser.parse_args()

    inp = Path(args.input)
    if not inp.exists():
        print(f"Error: {inp} not found.")
        sys.exit(1)

    stem = inp.stem.replace(" ", "_")
    out_json = Path(args.output) if args.output else Path(f"output_memory_{stem}.json")

    # Warm models to reflect running backend server
    _get_pipe()
    _get_embedding_components()

    if inp.suffix.lower() in [".mp4", ".mov", ".m4v", ".avi", ".webm"]:
        objects = await run_video(inp, args.room, out_json, target_fps=args.fps)
    elif inp.is_dir():
        objects = await run_image_folder(inp, args.room, out_json, use_stitch=True)
    else:
        objects = await run_single_image(inp, args.room, out_json)

    # Print first sample object schema
    if objects:
        print("\n--- SAMPLE OBJECT JSON SCHEMA ---")
        print(json.dumps(objects[0], indent=2))


if __name__ == "__main__":
    asyncio.run(main())
