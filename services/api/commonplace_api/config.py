from dataclasses import dataclass
import os
from pathlib import Path
import re

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
    azure_account_url: str = ""
    azure_container: str = "scene-images"
    max_upload_bytes: int = 8 * 1024 * 1024
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    app_env: str = "development"

    @classmethod
    def from_env(cls) -> "Settings":
        path = Path(os.getenv("DATA_DIR", ".data"))
        return cls(
            data_dir=path if path.is_absolute() else ROOT / path,
            vision_provider=os.getenv("VISION_PROVIDER", "demo"),
            storage_provider=os.getenv("STORAGE_PROVIDER", "local"),
            gemini_api_key=os.getenv("GEMINI_API_KEY", ""),
            gemini_model=os.getenv("GEMINI_MODEL", ""),
            azure_account_url=os.getenv("AZURE_STORAGE_ACCOUNT_URL", ""),
            azure_container=os.getenv("AZURE_STORAGE_CONTAINER", "scene-images"),
            max_upload_bytes=int(os.getenv("MAX_UPLOAD_BYTES", str(8 * 1024 * 1024))),
            cors_origins=tuple(x.strip() for x in os.getenv(
                "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
            ).split(",") if x.strip()),
            app_env=os.getenv("APP_ENV", "development"),
        )

    def validate(self) -> None:
        if self.app_env != "development":
            raise RuntimeError("This starter uses demo identity selection. Production auth must be implemented before deployment.")
        if self.vision_provider not in {"demo", "gemini"}:
            raise RuntimeError("VISION_PROVIDER must be demo or gemini")
        if self.vision_provider == "gemini" and not (self.gemini_api_key and self.gemini_model):
            raise RuntimeError("Gemini mode requires GEMINI_API_KEY and GEMINI_MODEL")
        if self.gemini_model and not re.fullmatch(r"[A-Za-z0-9._-]+", self.gemini_model):
            raise RuntimeError("GEMINI_MODEL must be a model ID without a URL or models/ prefix")
        if self.storage_provider not in {"local", "azure"}:
            raise RuntimeError("STORAGE_PROVIDER must be local or azure")
        if self.storage_provider == "azure" and not self.azure_account_url:
            raise RuntimeError("Azure storage requires AZURE_STORAGE_ACCOUNT_URL")
        if not 0 < self.max_upload_bytes <= 20 * 1024 * 1024:
            raise RuntimeError("MAX_UPLOAD_BYTES must be between 1 and 20971520")
