"""Local-only Muse text/voice sandbox. Never imports main, Store, vision, or storage."""
import os

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from .assistant import AssistantError
from .config import ROOT, Settings
from .models import ChatRequest, PlainChatResponse, TranscriptResponse
from .muse import plain_reply
from .voice import transcribe


def create_lab(settings: Settings | None = None) -> FastAPI:
    if os.getenv("APP_ENV", "development") != "development":
        raise RuntimeError("The Muse lab is a local development tool, not a public deployment.")
    # Ignore all database, Azure, and Gemini settings, including incomplete configs.
    settings = settings or Settings(data_dir=ROOT / ".data", meta_api_key=os.getenv("MODEL_API_KEY", "").strip(),
        meta_model=os.getenv("META_MODEL", "").strip(), meta_voice_model=os.getenv("META_VOICE_MODEL", "muse-voice-transcribe-1.0").strip())
    app = FastAPI(title="Commonplace Muse lab", description="Local plain chat and voice only. No household memory.")
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])

    def local_request(request: Request):
        origin = request.headers.get("origin")
        allowed = {f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (5173, 5174, 8002)}
        if origin and origin not in allowed:
            raise HTTPException(403, "The Muse lab accepts only local development origins.")
        try:
            settings.validate_muse()
        except RuntimeError as error:
            raise HTTPException(503, str(error)) from error

    @app.get("/api/lab/health")
    def health():
        try:
            settings.validate_muse()
            configured = True
        except RuntimeError:
            configured = False
        return {"status": "ok", "assistant_provider": "muse" if configured else "disabled",
                "mode": "plain", "memory_provider": "none", "configured": configured}

    @app.post("/api/lab/chat", response_model=PlainChatResponse, dependencies=[Depends(local_request)])
    async def chat(body: ChatRequest):
        try:
            return await plain_reply(settings, body)
        except AssistantError as error:
            raise HTTPException(error.status_code, str(error)) from error

    @app.post("/api/lab/transcribe", response_model=TranscriptResponse, dependencies=[Depends(local_request)])
    async def speech(audio: UploadFile = File(...)):
        try:
            return await transcribe(settings, audio)
        except AssistantError as error:
            raise HTTPException(error.status_code, str(error)) from error

    return app


app = create_lab()
