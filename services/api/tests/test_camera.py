import io

from fastapi.testclient import TestClient
from PIL import Image, ImageFilter
import pytest

from camera_capture.image_quality import TopFrameSelector
from commonplace_api.camera import CameraFrames
from commonplace_api.config import Settings
from commonplace_api.main import create_app


def jpeg(sharp=True):
    image = Image.new("RGB", (160, 120))
    image.putdata([(255, 255, 255) if (x // 8 + y // 8) % 2 else (0, 0, 0)
                   for y in range(120) for x in range(160)])
    if not sharp:
        image = image.filter(ImageFilter.GaussianBlur(4))
    result = io.BytesIO()
    image.save(result, format="JPEG")
    return result.getvalue()


def test_friend_selector_ranks_sharp_frames_and_bounds_retained_images():
    selector = TopFrameSelector(3)
    blurred = selector.consider(1, jpeg(False))
    sharp = selector.consider(2, jpeg())
    assert sharp.quality_score > blurred.quality_score
    selector.consider(3, jpeg(False))
    selector.consider(4, jpeg())
    assert len(selector.best_frames) == 3
    assert selector.best_frames[0].quality.frame_id == 2
    assert all(frame.jpeg for frame in selector.best_frames)
    with pytest.raises(ValueError):
        selector.consider(5, b"invalid image")


def test_camera_diagnostics_are_household_scoped_bounded_and_expire():
    at = [0]
    registry = CameraFrames(max_scans=2, ttl=10, clock=lambda: at[0])
    assert registry.observe("home-a", "scan", jpeg())["received_frames"] == 1
    at[0] = 4
    assert registry.observe("home-a", "scan", jpeg())["received_fps"] == .25
    assert registry.observe("home-b", "scan", jpeg())["received_frames"] == 1
    at[0] = 5
    registry.observe("home-c", "scan", jpeg())
    assert len(registry._scans) == 2
    at[0] = 20
    assert registry.observe("home-a", "scan", jpeg())["received_frames"] == 1
    assert len(registry._scans) == 1


def test_preview_needs_session_but_no_models_or_memory_writes(tmp_path, monkeypatch):
    def no_model(*args, **kwargs):
        raise AssertionError("Camera preview must not call a model")
    monkeypatch.setattr("commonplace_api.main.detect", no_model)
    with TestClient(create_app(Settings(seed_sample_data=True, data_dir=tmp_path))) as client:
        token = client.post("/api/guest/session", json={"name": "Camera tester"}).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        before = client.get("/api/objects", headers=headers).json()
        def upload(data, request_headers=headers):
            return client.post("/api/camera/frames", data={"scan_id": "camera-run-1"},
                               headers=request_headers, files={"image": ("frame.jpg", data, "image/jpeg")})
        assert upload(jpeg(), {}).status_code == 401
        first = upload(jpeg()).json()
        second = upload(jpeg(False)).json()
        assert first["quality"]["width"] == 160
        assert second["received_frames"] == 2
        assert len(second["top_frames"]) == 2
        assert upload(b"invalid").status_code == 422
        assert client.get("/api/objects", headers=headers).json() == before
        assert not list(tmp_path.glob("**/*.jpg"))


def test_preview_rejects_oversized_frames_before_decode(tmp_path):
    with TestClient(create_app(Settings(seed_sample_data=True, data_dir=tmp_path, max_upload_bytes=100))) as client:
        token = client.post("/api/guest/session", json={"name": "Camera tester"}).json()["token"]
        response = client.post("/api/camera/frames", headers={"Authorization": f"Bearer {token}"},
                               data={"scan_id": "camera-run-1"}, files={"image": ("frame.jpg", b"x" * 101, "image/jpeg")})
        assert response.status_code == 413
