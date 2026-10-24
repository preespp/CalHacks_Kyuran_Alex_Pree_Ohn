from datetime import datetime, timedelta, timezone
import io

from fastapi.testclient import TestClient
from PIL import Image

from commonplace_api.config import Settings
from commonplace_api.main import create_app
from commonplace_api.models import Detection
from commonplace_api.store import Store


def detection(location="On the desk", box=None, appearance="Red ceramic cup with a white star"):
    return Detection(label="Cup", appearance=appearance, location=location, bbox=box or [.1, .2, .4, .5])


def save(store, request, objects, second=0, scan="camera-scan-a", home="demo-home", room="Office"):
    at = (datetime(2026, 10, 24, tzinfo=timezone.utc) + timedelta(seconds=second)).isoformat()
    return store.save_capture({"id": "pree", "household_id": home}, request, request, request + ".jpg", room, objects, "gemini", at, scan)


def test_adjacent_unique_appearance_updates_location_box_and_image_without_user_attribution(tmp_path):
    store = Store(tmp_path / "memory.sqlite3")
    first = save(store, "frame-1", [detection()])
    second = save(store, "frame-2", [detection("On the shelf", [.5, .1, .8, .4])], 4)
    assert first["object_ids"] == second["object_ids"]
    items = store.objects("demo-home", "cup")
    assert len(items) == 1
    latest = items[0]["latest"]
    assert latest["location"] == "On the shelf"
    assert latest["bbox"] == [.5, .1, .8, .4]
    assert latest["image_url"] == "/api/images/frame-2.jpg"
    assert "actor_name" not in latest and "actor_id" not in latest
    assert len(store.history("demo-home", items[0]["id"])) == 2
    with store.connection() as db:
        assert db.execute("SELECT DISTINCT actor_id FROM observations").fetchall()[0][0] == ""
    assert save(store, "frame-2", [detection()], 8) == second  # Idempotent retry.


def test_ambiguous_or_blank_appearances_do_not_manufacture_unique_identity(tmp_path):
    store = Store(tmp_path / "memory.sqlite3")
    first = save(store, "frame-1", [detection(), detection()])
    second = save(store, "frame-2", [detection(), detection()], 4)
    assert set(first["object_ids"]).isdisjoint(second["object_ids"])
    blank1 = save(store, "frame-3", [detection(appearance="")], 8)
    blank2 = save(store, "frame-4", [detection(appearance="")], 12)
    assert blank1["object_ids"] != blank2["object_ids"]


def test_scan_scope_room_and_gap_prevent_unrelated_associations(tmp_path):
    store = Store(tmp_path / "memory.sqlite3")
    first = save(store, "frame-1", [detection()])
    other_scan = save(store, "frame-2", [detection()], 4, scan="camera-scan-b")
    other_home = save(store, "frame-3", [detection()], 4, home="other-home")
    other_room = save(store, "frame-4", [detection()], 8, room="Kitchen")
    after_gap = save(store, "frame-5", [detection()], 100, room="Kitchen")
    assert len({value["object_ids"][0] for value in [first, other_scan, other_home, other_room, after_gap]}) == 5


def test_late_or_empty_frame_does_not_erase_last_seen_location(tmp_path):
    store = Store(tmp_path / "memory.sqlite3")
    first = save(store, "new-frame", [detection("On the shelf")], 10)
    late = save(store, "late-frame", [detection("Old desk location")], 5)
    assert late["count"] == 0 and late["superseded"]
    assert store.objects("demo-home")[0]["latest"]["location"] == "On the shelf"
    assert save(store, "next-frame", [detection()], 14)["object_ids"] == first["object_ids"]
    empty = save(store, "empty-frame", [], 18)
    assert empty["count"] == 0
    assert len(store.objects("demo-home")) == 1


def test_camera_upload_updates_database_seen_by_another_guest(tmp_path, monkeypatch):
    calls = []
    async def fake_detect(settings, image, room):
        calls.append(room)
        return [detection("On the desk" if len(calls) == 1 else "On the shelf")]
    monkeypatch.setattr("commonplace_api.main.detect", fake_detect)
    settings = Settings(data_dir=tmp_path, vision_provider="gemini", gemini_vision_api_key="mock", gemini_model="mock")
    raw = io.BytesIO()
    Image.new("RGB", (100, 80), "red").save(raw, format="JPEG")
    with TestClient(create_app(settings)) as client:
        scanner = client.post("/api/guest/session", json={"name": "Camera user"}).json()["token"]
        reader = client.post("/api/guest/session", json={"name": "Other household member"}).json()["token"]
        def upload(request, scan="camera-run-1"):
            return client.post("/api/captures", headers={"Authorization": f"Bearer {scanner}"},
                               data={"room": "Office", "request_id": request, "scan_id": scan},
                               files={"image": ("frame.jpg", raw.getvalue(), "image/jpeg")})
        first = upload("frame-request-1")
        second = upload("frame-request-2")
        assert first.status_code == second.status_code == 201
        assert first.json()["frame_stats"]["received_frames"] == 1
        assert second.json()["frame_stats"]["received_frames"] == 2
        assert first.json()["object_ids"] == second.json()["object_ids"]
        latest = client.get("/api/objects?q=cup", headers={"Authorization": f"Bearer {reader}"}).json()["objects"][0]["latest"]
        assert latest["location"] == "On the shelf" and latest["source"] == "gemini"
        assert "actor_name" not in latest and "actor_id" not in latest
        assert upload("frame-request-2", "different-camera").status_code == 409
        activity = client.get("/api/activity", headers={"Authorization": f"Bearer {reader}"}).json()
        assert "Camera user" not in str(activity)
