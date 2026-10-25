from dataclasses import dataclass
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env", override=False)


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    vision_provider: str = "demo"
    storage_provider: str = "local"
    gemini_api_key: str = ""
    gemini_model: str = ""
    assistant_provider: str = "disabled"
    gemini_chat_model: str = ""
    gemini_chat_api_key: str = ""
    gemini_vision_api_key: str = ""
    meta_api_key: str = ""
    meta_model: str = ""
    meta_voice_model: str = "muse-voice-transcribe-1.0"
    max_upload_bytes: int = 8 * 1024 * 1024
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    app_env: str = "development"
    guest_profile_store: str = "auto"
    spacetime_url: str = ""
    spacetime_database: str = ""
    spacetime_token: str = ""
    spacetime_profile_access: str = "private"
    spacetime_profile_table: str = "guest_profile"
    camera_frame_sink: str = "disabled"
    camera_spacetime_url: str = ""
    camera_spacetime_database: str = ""
    camera_spacetime_token: str = ""
    memory_provider: str = "sqlite"
    seed_sample_data: bool = False
    vision_enrichment: str = "geometry"

    @classmethod
    def from_env(cls) -> "Settings":
        path = Path(os.getenv("DATA_DIR", ".data"))
        return cls(
            data_dir=path if path.is_absolute() else ROOT / path,
            vision_provider=os.getenv("VISION_PROVIDER", "demo"),
            storage_provider=os.getenv("STORAGE_PROVIDER", "local"),
            gemini_api_key=os.getenv("GEMINI_API_KEY", ""),
            gemini_model=os.getenv("GEMINI_MODEL", ""),
            assistant_provider=os.getenv("ASSISTANT_PROVIDER", "disabled"),
            gemini_chat_model=os.getenv("GEMINI_CHAT_MODEL", ""),
            gemini_chat_api_key=os.getenv("GEMINI_CHAT_API_KEY", ""),
            gemini_vision_api_key=os.getenv("GEMINI_VISION_API_KEY", ""),
            meta_api_key=os.getenv("MODEL_API_KEY", ""),
            meta_model=os.getenv("META_MODEL", ""),
            meta_voice_model=os.getenv("META_VOICE_MODEL", "muse-voice-transcribe-1.0"),
            max_upload_bytes=int(os.getenv("MAX_UPLOAD_BYTES", str(8 * 1024 * 1024))),
            cors_origins=tuple(x.strip() for x in os.getenv(
                "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
            ).split(",") if x.strip()),
            app_env=os.getenv("APP_ENV", "development"),
            guest_profile_store=os.getenv("GUEST_PROFILE_STORE", "auto"),
            spacetime_url=os.getenv("SPACETIMEDB_URL", ""),
            spacetime_database=os.getenv("SPACETIMEDB_DATABASE", ""),
            spacetime_token=os.getenv("SPACETIMEDB_SERVER_TOKEN", ""),
            spacetime_profile_access=os.getenv("SPACETIMEDB_PROFILE_ACCESS", "private"),
            spacetime_profile_table=os.getenv("SPACETIMEDB_PROFILE_TABLE", "guest_profile"),
            camera_frame_sink=os.getenv("CAMERA_FRAME_SINK", "disabled"),
            camera_spacetime_url=os.getenv("CAMERA_SPACETIMEDB_URL", ""),
            camera_spacetime_database=os.getenv("CAMERA_SPACETIMEDB_DATABASE", ""),
            camera_spacetime_token=os.getenv("CAMERA_SPACETIMEDB_TOKEN", ""),
            memory_provider=os.getenv("MEMORY_PROVIDER", "sqlite"),
            seed_sample_data=os.getenv("SEED_SAMPLE_DATA", "false").lower() == "true",
            vision_enrichment=os.getenv("VISION_ENRICHMENT", "geometry"),
        )

    @property
    def chat_api_key(self) -> str:
        return self.gemini_chat_api_key or self.gemini_api_key

    @property
    def vision_api_key(self) -> str:
        return self.gemini_vision_api_key or self.gemini_api_key

    def validate(self) -> None:
        if self.memory_provider not in {"sqlite", "spacetimedb"}:
            raise RuntimeError("MEMORY_PROVIDER must be sqlite or spacetimedb")
        if self.memory_provider == "spacetimedb" and self.camera_frame_sink != "spacetimedb":
            raise RuntimeError("SpacetimeDB memory requires CAMERA_FRAME_SINK=spacetimedb")
        if self.vision_enrichment not in {"geometry", "models"}:
            raise RuntimeError("VISION_ENRICHMENT must be geometry or models")
        if self.camera_frame_sink not in {"disabled", "spacetimedb"}:
            raise RuntimeError("CAMERA_FRAME_SINK must be disabled or spacetimedb")
        if self.camera_frame_sink == "spacetimedb":
            url = urlsplit(self.camera_spacetime_url)
            if (url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password
                    or url.query or url.fragment or url.path not in {"", "/"}):
                raise RuntimeError("CAMERA_SPACETIMEDB_URL must be an HTTP(S) server origin without credentials or a path")
            if url.scheme == "http" and url.hostname not in {"localhost", "127.0.0.1", "::1"}:
                raise RuntimeError("Remote camera SpacetimeDB requires HTTPS")
            if not re.fullmatch(r"[A-Za-z0-9._-]+", self.camera_spacetime_database):
                raise RuntimeError("Set a valid CAMERA_SPACETIMEDB_DATABASE")
        if self.guest_profile_store not in {"auto", "local", "sqlite", "spacetimedb"}:
            raise RuntimeError("GUEST_PROFILE_STORE must be auto, local, sqlite, or spacetimedb")
        if self.spacetime_profile_access not in {"private", "public"}:
            raise RuntimeError("SPACETIMEDB_PROFILE_ACCESS must be private or public")
        if self.spacetime_profile_table not in {"guest_profile", "user"}:
            raise RuntimeError("SPACETIMEDB_PROFILE_TABLE must be guest_profile or user")
        if self.spacetime_profile_table == "user" and self.spacetime_profile_access != "public":
            raise RuntimeError("The existing user table adapter requires SPACETIMEDB_PROFILE_ACCESS=public")
        if self.guest_profile_store == "spacetimedb" or (self.guest_profile_store == "auto" and (self.spacetime_token or self.spacetime_profile_access == "public")):
            url = urlsplit(self.spacetime_url)
            if (url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password
                    or url.query or url.fragment or url.path not in {"", "/"}):
                raise RuntimeError("SPACETIMEDB_URL must be an HTTP(S) server origin without credentials or a path")
            if url.scheme == "http" and url.hostname not in {"localhost", "127.0.0.1", "::1"}:
                raise RuntimeError("Remote SpacetimeDB requires HTTPS")
            if not re.fullmatch(r"[A-Za-z0-9._-]+", self.spacetime_database):
                raise RuntimeError("Set a valid SPACETIMEDB_DATABASE")
            if self.spacetime_profile_access == "private" and not self.spacetime_token:
                raise RuntimeError("Private guest profiles require SPACETIMEDB_SERVER_TOKEN")
        if self.app_env not in {"development", "prototype"}:
            raise RuntimeError("Use APP_ENV=development locally or prototype for the name-only demo. Production auth is not implemented.")
        if self.vision_provider not in {"demo", "gemini"}:
            raise RuntimeError("VISION_PROVIDER must be demo or gemini")
        if self.vision_provider == "gemini" and not (self.vision_api_key and self.gemini_model):
            raise RuntimeError("Gemini vision requires GEMINI_VISION_API_KEY (or legacy GEMINI_API_KEY) and GEMINI_MODEL")
        if self.assistant_provider not in {"disabled", "gemini", "muse"}:
            raise RuntimeError("ASSISTANT_PROVIDER must be disabled, muse, or gemini")
        if self.assistant_provider == "muse":
            self.validate_muse()
        if self.assistant_provider == "gemini" and not (self.chat_api_key and (self.gemini_chat_model or self.gemini_model)):
            raise RuntimeError("Gemini assistant requires GEMINI_CHAT_API_KEY (or legacy GEMINI_API_KEY) and GEMINI_CHAT_MODEL or GEMINI_MODEL")
        if self.gemini_model and not re.fullmatch(r"[A-Za-z0-9._-]+", self.gemini_model):
            raise RuntimeError("GEMINI_MODEL must be a model ID without a URL or models/ prefix")
        if self.gemini_chat_model and not re.fullmatch(r"[A-Za-z0-9._-]+", self.gemini_chat_model):
            raise RuntimeError("GEMINI_CHAT_MODEL must be a model ID without a URL or models/ prefix")
        if self.storage_provider != "local":
            raise RuntimeError("STORAGE_PROVIDER must be local; use a persistent DATA_DIR on the host")
        if not 0 < self.max_upload_bytes <= 20 * 1024 * 1024:
            raise RuntimeError("MAX_UPLOAD_BYTES must be between 1 and 20971520")

    def validate_muse(self) -> None:
        if not self.meta_api_key or not self.meta_model:
            raise RuntimeError("Muse requires MODEL_API_KEY and META_MODEL in the backend .env")
        if not re.fullmatch(r"[A-Za-z0-9._-]+", self.meta_model):
            raise RuntimeError("META_MODEL must be a model ID without a URL")
        if not re.fullmatch(r"[A-Za-z0-9._-]+", self.meta_voice_model):
            raise RuntimeError("META_VOICE_MODEL must be a model ID without a URL")
