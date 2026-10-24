"""Bounded Muse speech-to-text; WAV audio lives only in request memory."""
import io
import json
from uuid import uuid4
import wave

import httpx
from fastapi import HTTPException, UploadFile

from .assistant import AssistantError
from .config import Settings
from .models import TranscriptResponse

MAX_AUDIO_BYTES = 2 * 1024 * 1024


def validate_wav(raw: bytes) -> None:
    try:
        with wave.open(io.BytesIO(raw), "rb") as audio:
            frames = audio.getnframes()
            if (audio.getnchannels() != 1 or audio.getsampwidth() != 2 or
                    audio.getframerate() not in {16000, 24000} or audio.getcomptype() != "NONE" or
                    not 0 < frames <= audio.getframerate() * 30):
                raise ValueError("Unsupported audio")
            if len(audio.readframes(frames)) != frames * 2:
                raise ValueError("Truncated WAV")
    except (wave.Error, EOFError, ValueError) as error:
        raise HTTPException(422, "Use mono 16-bit PCM WAV at 16 or 24 kHz, up to 30 seconds.") from error


async def transcribe(settings: Settings, audio: UploadFile) -> TranscriptResponse:
    raw = await audio.read(MAX_AUDIO_BYTES + 1)
    await audio.close()
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Audio exceeds the 2 MiB test limit. Record a shorter clip.")
    validate_wav(raw)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10)) as client:
            response = await client.post("https://api.meta.ai/v1/asr/transcribe",
                params={"sessionId": uuid4().hex}, headers={"Authorization": f"Bearer {settings.meta_api_key}", "Accept": "application/json"},
                files={"request": (None, json.dumps({"mode": "PUSH_TO_TALK", "model": settings.meta_voice_model, "audioEncoding": "WAV"}), "application/json"),
                       "audio": ("speech.wav", raw, "audio/wav")})
            response.raise_for_status()
            text = response.json()["transcript"]
            if not isinstance(text, str) or not text.strip():
                raise AssistantError("No speech was recognized. Try speaking again or type your question.")
            if len(text.strip()) > 1000:
                raise AssistantError("The transcript is too long. Record a shorter question or type it.")
            return TranscriptResponse(text=text.strip())
    except httpx.HTTPStatusError as error:
        if error.response.status_code == 429:
            raise AssistantError("Muse transcription quota or credit limit was reached. You can still type.", 429) from error
        raise AssistantError("Meta rejected transcription. Check Muse Voice Transcribe access and eligible credits; typed chat is still available.") from error
    except httpx.RequestError as error:
        raise AssistantError("Muse transcription could not be reached. Try again or type your question.") from error
    except (KeyError, ValueError, TypeError, AttributeError) as error:
        raise AssistantError("Meta returned an invalid transcript. Try again or type your question.") from error
