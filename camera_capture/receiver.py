from __future__ import annotations

import asyncio
import logging
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from frontend import PAGE
from image_quality import TopFrameSelector


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("frame_receiver")
MAX_FRAME_BYTES = 5 * 1024 * 1024
app = FastAPI(title="Fieldframe Frame Receiver")


@app.get("/", response_class=HTMLResponse)
async def homepage() -> str:
    return PAGE


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws/frames")
async def receive_frames(websocket: WebSocket) -> None:
    await websocket.accept()
    connected_at = time.monotonic()
    received_frames = 0
    selector = TopFrameSelector(limit=3)
    logger.info("camera frame stream connected")

    try:
        while True:
            payload = await websocket.receive_bytes()
            if len(payload) > MAX_FRAME_BYTES:
                await websocket.close(code=1009, reason="Frame exceeds 5 MB limit")
                return

            try:
                quality = await asyncio.to_thread(selector.consider, received_frames + 1, payload)
            except ValueError as error:
                await websocket.send_json({"type": "error", "message": str(error)})
                continue

            received_frames += 1
            elapsed = max(time.monotonic() - connected_at, 0.001)
            top_frames = [candidate.quality.as_dict() for candidate in selector.best_frames]
            await websocket.send_json(
                {
                    "type": "frame",
                    "received_frames": received_frames,
                    "received_fps": round(received_frames / elapsed, 1),
                    "top_frames": top_frames,
                    **quality.as_dict(),
                }
            )
    except WebSocketDisconnect:
        logger.info(
            "camera stream disconnected after %s frames; top candidates: %s",
            received_frames,
            [candidate.quality.frame_id for candidate in selector.best_frames],
        )
