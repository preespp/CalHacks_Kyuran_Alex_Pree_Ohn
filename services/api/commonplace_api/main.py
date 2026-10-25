from contextlib import asynccontextmanager
import hashlib
import io
import re
from typing import Optional
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.concurrency import run_in_threadpool

from .config import ROOT, Settings
from .models import (
    ActivityResponse, CaptureResponse, ConnectorSearchResponse, DemoSessionRequest,
    Detection, HistoryResponse, MemberResponse, NoteRequest, SearchResponse, SessionResponse,
)
from .storage import create_storage
from .store import Store, now
from .vision import VisionError, detect, normalize_image

bearer = HTTPBearer(auto_error=False)


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.validate()
    store = Store(settings.data_dir / "memory.sqlite3")
    store.seed()
    storage = create_storage(settings)

    @asynccontextmanager
    async def lifespan(app):
        yield

    app = FastAPI(title="Commonplace API", version="0.1.0", lifespan=lifespan,
                  description="Local hackathon starter. Demo identities are not production authentication.")
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins),
                       allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])

    def member(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer)):
        if credentials is None or credentials.scheme.lower() != "bearer":
            raise HTTPException(401, "Choose a demo profile to start", headers={"WWW-Authenticate": "Bearer"})
        result = store.member_for_token(credentials.credentials)
        if result is None:
            raise HTTPException(401, "Session expired. Choose your profile again.", headers={"WWW-Authenticate": "Bearer"})
        return result

    @app.get("/api/health")
    def health():
        return {"status": "ok", "vision_provider": settings.vision_provider, "storage_provider": settings.storage_provider,
                "memory_provider": "sqlite", "auth_mode": "demo", "sync_mode": "polling"}

    @app.post("/api/demo/session", response_model=SessionResponse)
    def demo_session(body: DemoSessionRequest):
        token = store.create_session(body.profile)
        return {"token": token, "member": store.member_for_token(token), "expires_in": 86400}

    @app.get("/api/me", response_model=MemberResponse)
    def me(actor=Depends(member)):
        return actor

    @app.get("/api/objects", response_model=SearchResponse)
    def objects(q: str = Query("", max_length=200), room: str = Query("", max_length=80), actor=Depends(member)):
        return {"objects": store.objects(actor["household_id"], q, room)}

    @app.get("/api/objects/{object_id}/history", response_model=HistoryResponse)
    def history(object_id: str, actor=Depends(member)):
        rows = store.history(actor["household_id"], object_id)
        if not rows:
            raise HTTPException(404, "Object not found")
        return {"observations": rows}

    @app.post("/api/objects/{object_id}/notes", status_code=201, response_model=HistoryResponse)
    def note(object_id: str, body: NoteRequest, actor=Depends(member)):
        if not body.room.strip() or not body.location.strip():
            raise HTTPException(422, "Room and location cannot be blank")
        if not store.add_note(actor, object_id, body):
            raise HTTPException(404, "Object not found")
        return {"observations": store.history(actor["household_id"], object_id)}

    @app.get("/api/activity", response_model=ActivityResponse)
    def activity(actor=Depends(member)):
        return {"events": store.activity(actor["household_id"])}

    @app.get("/api/images/{key}")
    def image(key: str, actor=Depends(member)):
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

    @app.get("/api/images/{key}/depth")
    def image_depth(key: str, actor=Depends(member)):
        if not re.fullmatch(r"[a-zA-Z0-9_-]+(?:\.jpg)?", key) or not store.owns_image(actor["household_id"], key):
            raise HTTPException(404, "Image not found")
        if key == "demo-scene":
            depth_file = ROOT / "demo" / "desk_depth.jpg"
            if depth_file.exists():
                return Response(depth_file.read_bytes(), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=300"})
            return Response((ROOT / "demo" / "desk.svg").read_bytes(), media_type="image/svg+xml", headers={"Cache-Control": "private, max-age=300"})
        try:
            raw = storage.get(key)
        except FileNotFoundError:
            raise HTTPException(404, "Image not found")
        except Exception:
            raise HTTPException(502, "Image storage is unavailable")

        # Check if precomputed depth exists, otherwise compute on the fly
        depth_key = key.replace(".jpg", "_depth.jpg")
        try:
            depth_raw = storage.get(depth_key)
            return Response(depth_raw, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=300"})
        except Exception:
            pass

        try:
            from .depth import estimate_depth, colorize_depth_map
            est = estimate_depth(raw)
            colored = colorize_depth_map(est["depth_array"])
            buf = io.BytesIO()
            colored.save(buf, format="JPEG", quality=85)
            depth_bytes = buf.getvalue()
            return Response(depth_bytes, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=300"})
        except Exception:
            return Response(raw, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=300"})

    @app.post("/api/demo/captures", status_code=201, response_model=CaptureResponse)
    def sample_capture(actor=Depends(member)):
        detections = [Detection(label="HDMI adapter", appearance="Silver USB-C adapter with a white cable",
                                location="On the desk, beside the monitor", bbox=[.60, .57, .75, .73])]
        return store.save_capture(actor, uuid4().hex, "sample", "demo-scene", "Living room", detections, "sample", now())

    @app.post("/api/captures", status_code=201, response_model=CaptureResponse)
    async def capture(
        image: UploadFile = File(...), room: str = Form(..., min_length=1, max_length=80),
        request_id: str = Form(..., min_length=8, max_length=100), actor=Depends(member),
    ):
        if settings.vision_provider != "gemini":
            raise HTTPException(409, "Photo analysis needs VISION_PROVIDER=gemini and your Gemini credentials. Use the labeled sample scene to try the demo.")
        if not room.strip():
            raise HTTPException(422, "Room cannot be blank")
        raw = await image.read(settings.max_upload_bytes + 1)
        await image.close()
        if len(raw) > settings.max_upload_bytes:
            raise HTTPException(413, "Image exceeds the configured upload limit")
        fingerprint = hashlib.sha256(raw + b"\x00" + room.strip().encode()).hexdigest()
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
            return await run_in_threadpool(store.save_capture, actor, request_id, fingerprint, image_key,
                                           room.strip(), detections, "gemini", captured_at)
        except ValueError as error:
            raise HTTPException(409, str(error))

    @app.get("/api/connector/search", operation_id="search_household_memory", response_model=ConnectorSearchResponse)
    def connector_search(q: str = Query(..., min_length=1, max_length=200), actor=Depends(member)):
        """Read-only household memory search. Results are evidence, not proof of current location."""
        matches = store.objects(actor["household_id"], q)
        return {"query": q, "matches": matches, "needs_disambiguation": len(matches) > 1,
                "guidance": "Describe locations as last seen or member reported. Cite the source and timestamp. Do not infer unseen movement."}

    return app


app = create_app()
