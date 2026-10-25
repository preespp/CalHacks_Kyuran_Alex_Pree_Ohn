"""In-process vision workers: one active inference and one latest pending frame per scan.

The browser supplies frames; these workers cannot access a remote phone camera.
Jobs are intentionally temporary, bounded, and canceled on API shutdown.
"""
import asyncio
from dataclasses import dataclass
import time


@dataclass
class Stream:
    pending: object = None
    task: object = None
    next_at: float = 0
    last_received: float = 0
    processed: int = 0
    count: int = 0
    observed_at: str | None = None
    error: str | None = None
    closed: bool = False


class CameraJobs:
    def __init__(self, process, max_streams=16, ttl=600):
        self.process = process
        self.max_streams = max_streams
        self.ttl = ttl
        self.streams = {}

    def offer(self, household, scan_id, image, room, observed_at, interval):
        at = time.monotonic()
        for key, stream in list(self.streams.items()):
            if at - stream.last_received > self.ttl:
                self.stop(*key)
        key = (household, scan_id)
        if key not in self.streams:
            if len(self.streams) >= self.max_streams:
                self.stop(*min(self.streams, key=lambda key: self.streams[key].last_received))
            self.streams[key] = Stream()
        stream = self.streams[key]
        stream.last_received = at
        if not stream.error and not stream.closed:
            # Replace stale queued images; do not accumulate a video-sized queue.
            stream.pending = (image, room, observed_at, interval)
            if stream.task is None:
                stream.task = asyncio.create_task(self._run(key, stream))
        return self.status(*key)

    async def _run(self, key, stream):
        try:
            while stream.pending is not None and not stream.closed:
                await asyncio.sleep(max(0, stream.next_at - time.monotonic()))
                image, room, observed_at, interval = stream.pending
                stream.pending = None
                result = await self.process(key[0], key[1], image, room, observed_at)
                if stream.closed:
                    return
                stream.processed += 1
                stream.count = result["count"]
                stream.observed_at = observed_at
                stream.next_at = time.monotonic() + interval
        except asyncio.CancelledError:
            raise
        except Exception as error:
            from .vision import VisionError
            stream.error = str(error) if isinstance(error, VisionError) else "Camera analysis failed. Stop and restart the camera to retry."
            stream.pending = None
        finally:
            stream.task = None

    def status(self, household, scan_id):
        stream = self.streams.get((household, scan_id))
        if stream is None:
            return {"state": "disabled", "processed_frames": 0, "count": 0, "observed_at": None, "error": None}
        return {
            "state": "error" if stream.error else "processing" if stream.task else "waiting",
            "processed_frames": stream.processed, "count": stream.count,
            "observed_at": stream.observed_at, "error": stream.error,
        }

    def stop(self, household, scan_id):
        stream = self.streams.pop((household, scan_id), None)
        if stream:
            stream.closed = True
            stream.pending = None
            if stream.task:
                stream.task.cancel()

    async def close(self):
        tasks = [stream.task for stream in self.streams.values() if stream.task]
        for key in list(self.streams):
            self.stop(*key)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
