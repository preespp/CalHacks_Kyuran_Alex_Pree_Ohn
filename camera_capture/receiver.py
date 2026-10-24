from __future__ import annotations

import asyncio
from collections import deque
import logging
import secrets
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from frontend import PAGE
from image_quality import TopFrameSelector
from spacetime_stream import SPOOL, ROOT
from binary_stream import BinaryStream

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('frame_receiver')
MAX_FRAME_BYTES = 1024 * 1024
QUEUE_SIZE = 4
app = FastAPI(title='Fieldframe Frame Receiver')


@app.get('/', response_class=HTMLResponse)
async def homepage():
    return PAGE


@app.get('/health')
async def health():
    return {'status': 'ok'}


@app.websocket('/ws/frames')
async def receive_frames(websocket: WebSocket):
    access_file = ROOT / '.data/access-key'
    if not access_file.exists() or not secrets.compare_digest(websocket.query_params.get('key', ''), access_file.read_text().strip()):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    session = secrets.token_hex(16)
    directory = SPOOL / session
    directory.mkdir(parents=True, exist_ok=True)
    logger.info('SLAM stream: %s', directory)
    queue = asyncio.Queue(maxsize=QUEUE_SIZE)
    selector = TopFrameSelector(limit=3)
    completed_at = deque([time.monotonic()], maxlen=11)
    connected = True
    send_lock = asyncio.Lock()
    processed = 0

    async def send(message):
        nonlocal connected
        async with send_lock:
            if connected:
                try:
                    await websocket.send_json(message)
                except (WebSocketDisconnect, OSError, RuntimeError):
                    connected = False

    async def receive():
        nonlocal connected
        sequence = 0
        try:
            while True:
                payload = await websocket.receive_bytes()
                captured_us = time.time_ns() // 1000
                if len(payload) > MAX_FRAME_BYTES:
                    await websocket.close(code=1009, reason='Frame exceeds 1 MB limit')
                    break
                sequence += 1
                # Backpressure: no acceptance acknowledgment until a slot is free.
                await queue.put((sequence, captured_us, payload))
                await send({'type': 'queued', 'session': session, 'sequence': sequence,
                            'queue_depth': queue.qsize(), 'queue_capacity': QUEUE_SIZE})
        except WebSocketDisconnect:
            pass
        finally:
            connected = False
        # Queue the end marker after accepted frames, even after phone disconnect.
        await queue.put(None)

    async def consume():
        nonlocal processed
        pending = deque()

        async def complete_oldest():
            nonlocal processed
            task, quality, quality_ms = pending[0]
            database_ms = await task
            pending.popleft()
            processed += 1
            completed_at.append(time.monotonic())
            elapsed = max(completed_at[-1] - completed_at[0], 0.001)
            await send({'type': 'frame', 'session': session, 'received_frames': processed,
                        'received_fps': round((len(completed_at) - 1) / elapsed, 1),
                        'quality_ms': round(quality_ms, 1), 'database_ms': round(database_ms, 1),
                        'queue_depth': queue.qsize(), 'queue_capacity': QUEUE_SIZE,
                        'in_flight': len(pending),
                        'transport': 'binary-websocket',
                        'top_frames': [candidate.quality.as_dict() for candidate in selector.best_frames],
                        **quality.as_dict()})

        async with BinaryStream(session) as stream:
            async def upload(sequence, captured_us, payload, width, height):
                start = time.perf_counter()
                await stream.transfer(sequence, captured_us, payload, width, height)
                return (time.perf_counter() - start) * 1000

            next_item = asyncio.create_task(queue.get())
            try:
                while True:
                    if pending:
                        done, _ = await asyncio.wait([next_item, pending[0][0]], return_when=asyncio.FIRST_COMPLETED)
                        if pending[0][0] in done:
                            await complete_oldest()
                            continue
                    item = await next_item
                    if item is None:
                        break
                    sequence, captured_us, payload = item
                    started = time.perf_counter()
                    quality = await asyncio.to_thread(selector.consider, sequence, payload)
                    quality_ms = (time.perf_counter() - started) * 1000
                    task = asyncio.create_task(upload(sequence, captured_us, payload, quality.width, quality.height))
                    pending.append((task, quality, quality_ms))
                    if len(pending) >= 4:
                        await complete_oldest()
                    next_item = asyncio.create_task(queue.get())
                while pending:
                    await complete_oldest()
            finally:
                next_item.cancel()
                await asyncio.gather(next_item, return_exceptions=True)
                for task, _, _ in pending:
                    task.cancel()
                await asyncio.gather(*(task for task, _, _ in pending), return_exceptions=True)

    producer = asyncio.create_task(receive())
    consumer = asyncio.create_task(consume())
    try:
        done, _ = await asyncio.wait([producer, consumer], return_when=asyncio.FIRST_COMPLETED)
        if consumer in done:
            await consumer  # Propagate errors instead of leaving the producer blocked.
        else:
            await producer
            await consumer
    except Exception:
        logger.exception('Stream failed: %s', session)
        (directory / 'ERROR').write_text('Transfer failed; inspect receiver log and unacknowledged database rows.')
        await send({'type': 'error', 'message': 'Frame processing failed. Capture stopped; inspect receiver log.'})
        if connected:
            await websocket.close(code=1011)
    finally:
        producer.cancel()
        consumer.cancel()
        await asyncio.gather(producer, consumer, return_exceptions=True)
        (directory / 'DONE').touch()
        logger.info('Stream %s finished: %s frames saved', session, processed)
