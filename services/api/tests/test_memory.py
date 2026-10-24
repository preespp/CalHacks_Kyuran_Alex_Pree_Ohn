import io
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from commonplace_api.config import Settings
from commonplace_api.main import create_app
from commonplace_api.models import Detection
from commonplace_api.store import Store
from commonplace_api.vision import normalize_image


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path))) as client:
        yield client


def login(client, profile="pree"):
    response = client.post("/api/demo/session", json={"profile": profile})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def jpeg():
    output = io.BytesIO()
    Image.new("RGB", (100, 80), "green").save(output, format="JPEG")
    return output.getvalue()


@pytest.mark.parametrize("path", ["/api/objects", "/api/activity", "/api/images/demo-scene", "/api/objects/adapter/history", "/api/connector/search?q=keys"])
def test_memory_and_images_require_a_session(client, path):
    assert client.get(path).status_code == 401


def test_seed_and_search_expose_evidence(client):
    headers = login(client)
    objects = client.get("/api/objects?q=where is our movie night adapter?", headers=headers).json()["objects"]
    assert len(objects) == 1
    assert objects[0]["label"] == "HDMI adapter"
    assert objects[0]["latest"]["source"] == "sample"
    assert objects[0]["latest"]["bbox"] == [.6, .57, .75, .73]
    assert client.get(objects[0]["last_visual"]["image_url"], headers=headers).headers["content-type"].startswith("image/svg+xml")


def test_update_is_shared_and_does_not_fabricate_new_photo(client):
    alex = login(client, "alex")
    pree = login(client, "pree")
    response = client.post("/api/objects/adapter/notes", headers=alex,
                           json={"room": "Kitchen", "location": "In the top drawer", "kind": "moved"})
    assert response.status_code == 201
    item = client.get("/api/objects?q=adapter", headers=pree).json()["objects"][0]
    assert item["latest"]["actor_name"] == "Alex"
    assert item["latest"]["source"] == "reported"
    assert item["latest"]["image_url"] is None
    assert item["latest"]["bbox"] is None
    assert item["last_visual"]["source"] == "sample"
    assert item["last_visual"]["room"] == "Living room"
    assert len(client.get("/api/objects/adapter/history", headers=pree).json()["observations"]) == 2


def test_sessions_and_history_survive_restart(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path))) as first:
        headers = login(first)
        first.post("/api/objects/keys/notes", headers=headers,
                   json={"room": "Entryway", "location": "In the bowl", "kind": "found"})
    with TestClient(create_app(Settings(data_dir=tmp_path))) as second:
        keys = second.get("/api/objects?q=keys", headers=headers).json()["objects"][0]
        assert keys["latest"]["room"] == "Entryway"
        assert len(second.get("/api/objects/keys/history", headers=headers).json()["observations"]) == 2


def test_foreign_household_cannot_read_or_mutate(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path))) as client:
        store = Store(tmp_path / "memory.sqlite3")
        with store.connection() as db:
            db.execute("INSERT INTO members VALUES ('outsider', 'other-home', 'Outsider')")
        token = store.create_session("outsider")
        headers = {"Authorization": f"Bearer {token}"}
        assert client.get("/api/objects", headers=headers).json() == {"objects": []}
        assert client.get("/api/activity", headers=headers).json() == {"events": []}
        assert client.get("/api/images/demo-scene", headers=headers).status_code == 404
        assert client.get("/api/objects/adapter/history", headers=headers).status_code == 404
        assert client.post("/api/objects/adapter/notes", headers=headers,
                           json={"room": "Office", "location": "Mine", "kind": "moved"}).status_code == 404
        assert client.get("/api/connector/search?q=adapter", headers=headers).json()["matches"] == []


def test_demo_does_not_pretend_to_analyze_arbitrary_upload(client):
    headers = login(client)
    response = client.post("/api/captures", headers=headers, data={"room": "Kitchen", "request_id": "capture-1"}, files={"image": ("test.jpg", jpeg(), "image/jpeg")})
    assert response.status_code == 409
    assert len(client.get("/api/objects", headers=headers).json()["objects"]) == 4
    sample = client.post("/api/demo/captures", headers=headers)
    assert sample.status_code == 201
    assert sample.json()["source"] == "sample"


def test_gemini_capture_is_private_validated_and_idempotent(tmp_path, monkeypatch):
    calls = []

    async def fake_detect(settings, image, room):
        calls.append(room)
        return [Detection(label="Red notebook", appearance="A small red notebook", location="On the table", bbox=[.1, .2, .4, .5])]

    monkeypatch.setattr("commonplace_api.main.detect", fake_detect)
    settings = Settings(data_dir=tmp_path, vision_provider="gemini", gemini_api_key="test", gemini_model="test-model")
    with TestClient(create_app(settings)) as client:
        headers = login(client)
        data = {"room": "Office", "request_id": "same-capture-id"}
        files = {"image": ("anything.jpg", jpeg(), "image/jpeg")}
        first = client.post("/api/captures", headers=headers, data=data, files=files)
        assert first.status_code == 201
        second = client.post("/api/captures", headers=headers, data=data, files=files)
        assert first.json() == second.json()
        assert calls == ["Office"]
        item = client.get("/api/objects?q=notebook", headers=headers).json()["objects"][0]
        assert item["latest"]["source"] == "gemini"
        image_url = item["latest"]["image_url"]
        assert client.get(image_url).status_code == 401
        assert client.get(image_url, headers=headers).status_code == 200
        assert client.post("/api/captures", headers=headers, data={**data, "room": "Bedroom"}, files=files).status_code == 409


def test_invalid_and_oversized_uploads_fail_before_vision(tmp_path, monkeypatch):
    async def must_not_call(*args):
        raise AssertionError("Invalid images must not reach the model")

    monkeypatch.setattr("commonplace_api.main.detect", must_not_call)
    settings = Settings(data_dir=tmp_path, vision_provider="gemini", gemini_api_key="test", gemini_model="test", max_upload_bytes=1000)
    with TestClient(create_app(settings)) as client:
        headers = login(client)
        data = {"room": "Office", "request_id": "capture-1234"}
        assert client.post("/api/captures", headers=headers, data=data, files={"image": ("fake.jpg", b"not an image", "image/jpeg")}).status_code == 422
        assert client.post("/api/captures", headers=headers, data=data, files={"image": ("huge.jpg", b"x" * 1001, "image/jpeg")}).status_code == 413


def test_exif_rotation_applies_before_box_coordinates():
    image = Image.new("RGB", (40, 20), "red")
    exif = image.getexif()
    exif[274] = 6
    output = io.BytesIO()
    image.save(output, format="JPEG", exif=exif)
    with Image.open(io.BytesIO(normalize_image(output.getvalue()))) as normalized:
        assert normalized.size == (20, 40)
        assert not normalized.getexif()


def test_older_observation_does_not_replace_latest(tmp_path):
    store = Store(tmp_path / "memory.sqlite3")
    store.seed()
    old = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    with store.connection() as db:
        db.execute("INSERT INTO observations VALUES ('late-result', 'adapter', 'demo-home', 'Kitchen', 'Old location', NULL, NULL, 'reported', 'alex', ?, ?, 'moved')", (old, datetime.now(timezone.utc).isoformat()))
    assert store.objects("demo-home", "adapter")[0]["latest"]["room"] == "Living room"


def test_demo_auth_cannot_start_as_production(tmp_path):
    with pytest.raises(RuntimeError, match="Production auth"):
        create_app(Settings(data_dir=tmp_path, app_env="production"))


def test_blank_notes_and_bad_boxes_are_rejected(client):
    headers = login(client)
    assert client.post("/api/objects/keys/notes", headers=headers,
                       json={"room": " ", "location": " ", "kind": "moved"}).status_code == 422
    with pytest.raises(ValueError):
        Detection(label="key", location="desk", bbox=[.8, .2, .1, .5])
