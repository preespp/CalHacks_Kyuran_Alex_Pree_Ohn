from contextlib import asynccontextmanager
import hashlib
import re
import time
from typing import Optional
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.concurrency import run_in_threadpool

from .config import ROOT, Settings
from .camera import CameraFrames
from .camera_jobs import CameraJobs
from .assistant import AssistantError, answer_question
from .memory import search_household_memory
from .guest_profiles import create_profiles, ProfileError
from .frame_sink import create_frame_sink, FrameUploadError
from .object_memory import SpacetimeMemory, ObjectMemoryError
from .muse import memory_reply
from .voice import transcribe
from .models import (
    ActivityResponse, CameraAnalysisResponse, CameraFramesResponse, CaptureResponse, ChatRequest, ChatResponse, ConnectorSearchResponse, DemoSessionRequest,
    Detection, GuestSessionRequest, HistoryResponse, MemberResponse, NoteRequest, SearchResponse, SessionResponse, TranscriptResponse,
)
from .storage import create_storage
from .store import Store, now
from .vision import VisionError, detect, normalize_image

bearer = HTTPBearer(auto_error=False)


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.validate()
    store = Store(settings.data_dir / "memory.sqlite3", include_samples=settings.seed_sample_data)
    store.seed()
    profiles = create_profiles(settings, store)
    storage = create_storage(settings)
    camera = CameraFrames()
    frame_sink = create_frame_sink(settings)
    memory = SpacetimeMemory(settings) if settings.memory_provider == "spacetimedb" else store

    async def analyze_frame(household, scan_id, normalized, room, captured_at):
        if isinstance(memory, SpacetimeMemory):
            return await memory.analyze(settings, frame_sink, household, scan_id, normalized, room, captured_at)
        detections = await detect(settings, normalized, room)
        image_key = uuid4().hex + ".jpg"
        if detections:
            await run_in_threadpool(storage.put, image_key, normalized)
        return await run_in_threadpool(
            store.save_capture, {"household_id": household}, uuid4().hex,
            hashlib.sha256(normalized).hexdigest(), image_key, room,
            detections, "gemini", captured_at, scan_id,
        )

    camera_jobs = CameraJobs(analyze_frame)

    @asynccontextmanager
    async def lifespan(app):
        try:
            yield
        finally:
            await camera_jobs.close()

    app = FastAPI(title="Commonplace API", version="0.1.0", lifespan=lifespan,
                  description="Name-only guest prototype. Guests share one demo household; names are unverified.")
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins),
                       allow_methods=["GET", "POST", "DELETE"], allow_headers=["Authorization", "Content-Type"])

    @app.exception_handler(ObjectMemoryError)
    async def unavailable_memory(request, error):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=503, content={"detail": str(error)})

    def member(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer)):
        if credentials is None or credentials.scheme.lower() != "bearer":
            raise HTTPException(401, "Enter your name to join as a guest", headers={"WWW-Authenticate": "Bearer"})
        result = store.member_for_token(credentials.credentials)
        if result and result["id"].startswith("guest-") and profiles.provider == "local" and not profiles.get(result["id"]):
            result = None
        if result is None:
            raise HTTPException(401, "Session expired. Enter your name again.", headers={"WWW-Authenticate": "Bearer"})
        return result

    @app.get("/api/health")
    def health():
        return {"status": "ok", "vision_provider": settings.vision_provider, "storage_provider": settings.storage_provider,
                "assistant_provider": settings.assistant_provider,
                "memory_provider": settings.memory_provider, "auth_mode": "guest", "sync_mode": "polling",
                "sample_data": settings.seed_sample_data,
                "vision_pipeline": "onyu" if isinstance(memory, SpacetimeMemory) else "basic",
                "vision_enrichment": settings.vision_enrichment,
                "guest_profile_store": profiles.provider, "camera_frame_sink": settings.camera_frame_sink,
                "guest_profile_table": settings.spacetime_profile_table if profiles.provider == "spacetimedb" else None}

    @app.get("/api/guest/users")
    def guest_users():
        try:
            return {"users": profiles.list(), "storage": profiles.provider, "notice": profiles.notice}
        except ProfileError as error:
            raise HTTPException(503, str(error)) from error

    @app.post("/api/guest/session", response_model=SessionResponse)
    def guest_session(body: GuestSessionRequest, credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer)):
        previous = credentials.credentials if credentials and credentials.scheme.lower() == "bearer" else None
        try:
            profile = profiles.get(body.user_id) if body.user_id else profiles.create(body.name)
        except ProfileError as error:
            raise HTTPException(503, str(error)) from error
        if not profile:
            raise HTTPException(404, "This saved user is unavailable. Reload the user list or add a new user.")
        token = store.session_for_guest_profile(profile, previous)
        return {"token": token, "member": store.member_for_token(token), "expires_in": 86400}

    @app.delete("/api/guest/session", status_code=204)
    def leave_guest_session(actor=Depends(member), credentials: HTTPAuthorizationCredentials = Depends(bearer)):
        store.revoke_session(credentials.credentials)
        return Response(status_code=204)

    @app.post("/api/demo/session", response_model=SessionResponse)
    def demo_session(body: DemoSessionRequest):
        if settings.app_env != "development" or not settings.seed_sample_data:
            raise HTTPException(404, "Not found")
        token = store.create_session(body.profile)
        return {"token": token, "member": store.member_for_token(token), "expires_in": 86400}

    @app.get("/api/me", response_model=MemberResponse)
    def me(actor=Depends(member)):
        return actor

    @app.get("/api/objects", response_model=SearchResponse)
    def objects(q: str = Query("", max_length=200), room: str = Query("", max_length=80), actor=Depends(member)):
        return {"objects": memory.objects(actor["household_id"], q, room)}

    @app.get("/api/objects/{object_id}/history", response_model=HistoryResponse)
    def history(object_id: str, actor=Depends(member)):
        rows = memory.history(actor["household_id"], object_id)
        if not rows:
            raise HTTPException(404, "Object not found")
        return {"observations": rows}

    @app.post("/api/objects/{object_id}/notes", status_code=201, response_model=HistoryResponse)
    def note(object_id: str, body: NoteRequest, actor=Depends(member)):
        if isinstance(memory, SpacetimeMemory):
            raise HTTPException(405, "Live object locations are updated from camera observations.")
        if not body.room.strip() or not body.location.strip():
            raise HTTPException(422, "Room and location cannot be blank")
        if not store.add_note(actor, object_id, body):
            raise HTTPException(404, "Object not found")
        return {"observations": store.history(actor["household_id"], object_id)}

    @app.get("/api/activity", response_model=ActivityResponse)
    def activity(actor=Depends(member)):
        return {"events": memory.activity(actor["household_id"])}

    @app.get("/api/images/{key}")
    def image(key: str, actor=Depends(member)):
        if isinstance(memory, SpacetimeMemory):
            if not re.fullmatch(r"stream-[a-f0-9]{32}-[1-9][0-9]*\.jpg", key):
                raise HTTPException(404, "Image not found")
            try:
                return Response(memory.get_image(actor["household_id"], key), media_type="image/jpeg",
                                headers={"Cache-Control": "private, max-age=300"})
            except FileNotFoundError:
                raise HTTPException(404, "Image not found") from None
        if not re.fullmatch(r"[a-zA-Z0-9_-]+(?:\.jpg)?", key) or not store.owns_image(actor["household_id"], key):
            raise HTTPException(404, "Image not found")
        if key == "demo-scene":
            return Response((ROOT / "demo" / "desk.svg").read_bytes(), media_type="image/svg+xml", headers={"Cache-Control": "private, max-age=300"})
        try:
            raw = storage.get(key)
        except FileNotFoundError:
            raise HTTPException(404, "Image not found")
        except Exception:
            raise HTTPException(502, "Image storage is unavailable")
        return Response(raw, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=300"})

    @app.post("/api/demo/captures", status_code=201, response_model=CaptureResponse)
    def sample_capture(actor=Depends(member)):
        if not settings.seed_sample_data or isinstance(memory, SpacetimeMemory):
            raise HTTPException(404, "Not found")
        detections = [Detection(label="HDMI adapter", appearance="Silver USB-C adapter with a white cable",
                                location="On the desk, beside the monitor", bbox=[.60, .57, .75, .73])]
        return store.save_capture(actor, uuid4().hex, "sample", "demo-scene", "Living room", detections, "sample", now())

    @app.post("/api/captures", status_code=201, response_model=CaptureResponse)
    async def capture(
        image: UploadFile = File(...), room: str = Form(..., min_length=1, max_length=80),
        request_id: str = Form(..., min_length=8, max_length=100), actor=Depends(member),
        scan_id: Optional[str] = Form(None, min_length=8, max_length=100, pattern=r"^[A-Za-z0-9_-]+$"),
    ):
        if isinstance(memory, SpacetimeMemory):
            raise HTTPException(409, "Use the live camera to update shared object memory.")
        if settings.vision_provider != "gemini":
            raise HTTPException(409, "Photo analysis needs VISION_PROVIDER=gemini and your Gemini credentials.")
        if not room.strip():
            raise HTTPException(422, "Room cannot be blank")
        raw = await image.read(settings.max_upload_bytes + 1)
        await image.close()
        if len(raw) > settings.max_upload_bytes:
            raise HTTPException(413, "Image exceeds the configured upload limit")
        fingerprint = hashlib.sha256(raw + b"\x00" + room.strip().encode() + (b"\x00" + scan_id.encode() if scan_id else b"")).hexdigest()
        cached = await run_in_threadpool(store.cached_capture, actor["household_id"], request_id)
        if cached:
            if cached[0] != fingerprint:
                raise HTTPException(409, "Request ID already belongs to a different capture")
            return cached[1]
        try:
            normalized = await run_in_threadpool(normalize_image, raw)
        except ValueError as error:
            raise HTTPException(422, str(error))
        captured_at = now()  # Receipt time, before inference; later results cannot become newer by finishing late.
        frame_stats = await run_in_threadpool(camera.observe, actor["household_id"], scan_id, normalized) if scan_id else None
        try:
            detections = await detect(settings, normalized, room.strip())
        except VisionError as error:
            raise HTTPException(502, str(error))
        image_key = uuid4().hex + ".jpg"
        if detections:
            try:
                await run_in_threadpool(storage.put, image_key, normalized)
            except Exception:
                raise HTTPException(502, "Image could not be stored. No objects were saved.")
        try:
            result = await run_in_threadpool(store.save_capture, actor, request_id, fingerprint, image_key,
                                            room.strip(), detections, "gemini", captured_at, scan_id)
            return {**result, "frame_stats": frame_stats}
        except ValueError as error:
            raise HTTPException(409, str(error))

    @app.post("/api/camera/frames", response_model=CameraFramesResponse)
    async def camera_frame(
        image: UploadFile = File(...),
        scan_id: str = Form(..., min_length=8, max_length=100, pattern=r"^[A-Za-z0-9_-]+$"),
        room: str = Form("Living room", min_length=1, max_length=80),
        memory_enabled: bool = Form(False),
        analysis_interval: float = Form(5, ge=1, le=30),
        actor=Depends(member),
    ):
        """Fast frame ingestion. Optional backend vision worker samples the latest frame."""
        if not room.strip():
            raise HTTPException(422, "Room cannot be blank")
        if memory_enabled and settings.vision_provider != "gemini":
            raise HTTPException(409, "Enable Gemini vision to update shared memory. Camera preview remains available.")
        raw = await image.read(settings.max_upload_bytes + 1)
        await image.close()
        if len(raw) > settings.max_upload_bytes:
            raise HTTPException(413, "Image exceeds the configured upload limit")
        try:
            # Normalize before measuring dimensions so the metadata, queue bytes,
            # quality preview and Gemini input all describe the same frame.
            normalized = await run_in_threadpool(
                normalize_image, raw, max_dimension=1920 if frame_sink else 2048,
                max_bytes=1024 * 1024 if frame_sink else None,
            )
            captured_at = now()
            captured_us = time.time_ns() // 1000
            stats = await run_in_threadpool(camera.observe, actor["household_id"], scan_id, normalized)
            if frame_sink:
                quality = stats["quality"]
                stats["image_upload"] = await frame_sink.put(
                    actor["household_id"], scan_id, stats["received_frames"], captured_us,
                    quality["width"], quality["height"], normalized,
                )
            queued_frame = ({"receipt": stats["image_upload"], "sha256": hashlib.sha256(normalized).hexdigest(),
                             "width": stats["quality"]["width"], "height": stats["quality"]["height"]}
                            if isinstance(memory, SpacetimeMemory) else normalized)
            if memory_enabled:
                stats["analysis"] = camera_jobs.offer(actor["household_id"], scan_id, queued_frame, room.strip(), captured_at, analysis_interval)
            else:
                camera_jobs.stop(actor["household_id"], scan_id)
                stats["analysis"] = camera_jobs.status(actor["household_id"], scan_id)
            return stats
        except FrameUploadError as error:
            raise HTTPException(502, str(error)) from None
        except ValueError as error:
            raise HTTPException(422, str(error))

    @app.get("/api/camera/streams/{scan_id}", response_model=CameraAnalysisResponse)
    async def camera_status(scan_id: str, actor=Depends(member)):
        return camera_jobs.status(actor["household_id"], scan_id)

    @app.delete("/api/camera/streams/{scan_id}", status_code=204)
    async def stop_camera(scan_id: str, actor=Depends(member)):
        camera_jobs.stop(actor["household_id"], scan_id)
        return Response(status_code=204)

    @app.get("/api/connector/search", operation_id="search_household_memory", response_model=ConnectorSearchResponse)
    def connector_search(q: str = Query(..., min_length=1, max_length=200), actor=Depends(member)):
        """Read-only household memory search. Results are evidence, not proof of current location."""
        return search_household_memory(memory, actor["household_id"], q)

    @app.post("/api/chat", response_model=ChatResponse)
    async def chat(body: ChatRequest, actor=Depends(member)):
        if settings.assistant_provider not in {"muse", "gemini"}:
            raise HTTPException(409, "Enable ASSISTANT_PROVIDER=muse with MODEL_API_KEY and META_MODEL, then restart the API.")

        async def scoped_search(query: str):
            return await run_in_threadpool(search_household_memory, memory, actor["household_id"], query)

        try:
            provider = memory_reply if settings.assistant_provider == "muse" else answer_question
            return await provider(settings, body, scoped_search)
        except AssistantError as error:
            raise HTTPException(error.status_code, str(error)) from error

    @app.post("/api/voice/transcribe", response_model=TranscriptResponse)
    async def speech(audio: UploadFile = File(...), actor=Depends(member)):
        if settings.assistant_provider != "muse":
            raise HTTPException(409, "Enable the Muse assistant to use Muse Voice Transcribe.")
        try:
            return await transcribe(settings, audio)
        except AssistantError as error:
            raise HTTPException(error.status_code, str(error)) from error

    return app


app = create_app()
