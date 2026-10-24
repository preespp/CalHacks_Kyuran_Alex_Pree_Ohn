from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DemoSessionRequest(BaseModel):
    profile: Literal["alex", "pree", "kyuran"] = "pree"


class GuestSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: Optional[str] = Field(default=None, min_length=1, max_length=50)
    user_id: Optional[str] = Field(default=None, pattern=r"^guest-[a-f0-9]{32}$")

    @model_validator(mode="after")
    def single_line_name(self) -> "GuestSessionRequest":
        if (self.name is None) == (self.user_id is None):
            raise ValueError("Provide either a new name or an existing user_id")
        if self.name and any(ord(char) < 32 or ord(char) == 127 for char in self.name):
            raise ValueError("Use a single-line display name")
        return self


class Detection(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    appearance: str = Field(default="", max_length=500)
    location: str = Field(min_length=1, max_length=300)
    bbox: list[float] = Field(min_length=4, max_length=4)

    @model_validator(mode="after")
    def valid_box(self) -> "Detection":
        x1, y1, x2, y2 = self.bbox
        if not all(0 <= n <= 1 for n in self.bbox) or x1 >= x2 or y1 >= y2:
            raise ValueError("bbox must be normalized [xmin, ymin, xmax, ymax] with positive area")
        return self


class DetectionBatch(BaseModel):
    objects: list[Detection] = Field(max_length=30)


class NoteRequest(BaseModel):
    room: str = Field(min_length=1, max_length=80)
    location: str = Field(min_length=1, max_length=300)
    kind: Literal["moved", "found", "correction"] = "moved"


class MemberResponse(BaseModel):
    id: str
    household_id: str
    name: str


class SessionResponse(BaseModel):
    token: str
    member: MemberResponse
    expires_in: int


class ObservationResponse(BaseModel):
    id: str
    object_id: str
    room: str
    location: str
    image_url: Optional[str]
    bbox: Optional[list[float]]
    source: Literal["sample", "gemini", "reported"]
    kind: Literal["seen", "moved", "found", "correction"]
    observed_at: str
    label: Optional[str] = None


class ObjectResponse(BaseModel):
    id: str
    label: str
    appearance: str
    aliases: list[str]
    latest: ObservationResponse
    last_visual: Optional[ObservationResponse]


class SearchResponse(BaseModel):
    objects: list[ObjectResponse]


class HistoryResponse(BaseModel):
    observations: list[ObservationResponse]


class ActivityResponse(BaseModel):
    events: list[ObservationResponse]


class FrameQualityResponse(BaseModel):
    frame_id: int
    width: int
    height: int
    sharpness: float
    brightness: float
    quality_score: float


class CameraAnalysisResponse(BaseModel):
    state: Literal["disabled", "waiting", "processing", "error"]
    processed_frames: int
    count: int
    observed_at: Optional[str]
    error: Optional[str]


class CameraFramesResponse(BaseModel):
    received_frames: int
    received_fps: float
    quality: FrameQualityResponse
    top_frames: list[FrameQualityResponse]
    analysis: Optional[CameraAnalysisResponse] = None


class CaptureResponse(BaseModel):
    capture_id: str
    object_ids: list[str]
    count: int
    source: Literal["sample", "gemini"]
    superseded: bool = False
    frame_stats: Optional[CameraFramesResponse] = None


class ConnectorSearchResponse(BaseModel):
    query: str
    matches: list[ObjectResponse]
    needs_disambiguation: bool
    guidance: str


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    message: str = Field(min_length=1, max_length=1000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=8)


class ChatResponse(BaseModel):
    provider: Literal["gemini", "muse"] = "gemini"
    answer: str
    query: str
    matches: list[ObjectResponse]
    total_matches: int
    needs_disambiguation: bool


class PlainChatResponse(BaseModel):
    provider: Literal["muse"] = "muse"
    answer: str


class TranscriptResponse(BaseModel):
    text: str
    provider: Literal["muse"] = "muse"
