import hashlib

from fastapi.testclient import TestClient
import pytest

from commonplace_api.config import Settings
from commonplace_api.main import create_app
from commonplace_api.store import Store


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path))) as client:
        yield client


def join(client, name, token=None):
    response = client.post("/api/guest/session", json={"name": name},
                           headers={"Authorization": f"Bearer {token}"} if token else {})
    assert response.status_code == 200
    return response.json()


def headers(session):
    return {"Authorization": f"Bearer {session['token']}"}


def test_guest_joins_with_only_a_trimmed_name_and_token_is_hashed(client, tmp_path):
    guest = join(client, "  ปรี Pree  ")
    assert guest["member"]["name"] == "ปรี Pree"
    assert guest["member"]["household_id"] == "demo-home"
    assert guest["expires_in"] == 86400
    assert client.get("/api/me", headers=headers(guest)).json() == guest["member"]
    store = Store(tmp_path / "memory.sqlite3")
    with store.connection() as db:
        row = db.execute("SELECT token_hash FROM sessions").fetchone()
        assert row["token_hash"] == hashlib.sha256(guest["token"].encode()).hexdigest()


@pytest.mark.parametrize("body", [
    {}, {"name": ""}, {"name": "   "}, {"name": "x" * 51},
    {"name": "two\nlines"}, {"name": "Guest", "household_id": "other-home"},
])
def test_invalid_names_and_attempted_household_selection_are_rejected(client, body):
    assert client.post("/api/guest/session", json=body).status_code == 422


def test_names_do_not_reuse_existing_identities_and_guests_share_reports(client):
    first = join(client, "Alex")
    second = join(client, "Alex")
    assert first["member"]["id"] != second["member"]["id"]
    assert first["member"]["id"] != "alex"
    response = client.post("/api/objects/adapter/notes", headers=headers(first),
                           json={"room": "Kitchen", "location": "Guest test drawer", "kind": "moved"})
    assert response.status_code == 201
    latest = client.get("/api/objects?q=adapter", headers=headers(second)).json()["objects"][0]["latest"]
    assert "actor_name" not in latest and "actor_id" not in latest
    assert latest["location"] == "Guest test drawer"
    assert latest["source"] == "reported"


def test_switching_and_leaving_revoke_only_the_current_session(client):
    original = join(client, "Pree")
    other = join(client, "Kyuran")
    replacement = join(client, "Alex", original["token"])
    assert client.get("/api/me", headers=headers(original)).status_code == 401
    assert client.get("/api/me", headers=headers(replacement)).status_code == 200
    assert client.delete("/api/guest/session", headers=headers(replacement)).status_code == 204
    assert client.get("/api/objects", headers=headers(replacement)).status_code == 401
    assert client.get("/api/me", headers=headers(other)).status_code == 200
    assert client.delete("/api/guest/session").status_code == 401


def test_guest_session_survives_api_restart(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path, guest_profile_store="sqlite"))) as first:
        guest = join(first, "Guest tester")
    with TestClient(create_app(Settings(data_dir=tmp_path, guest_profile_store="sqlite"))) as second:
        assert second.get("/api/me", headers=headers(guest)).json()["name"] == "Guest tester"
        assert second.get("/api/guest/users").json()["users"] == [guest["member"]]


def test_select_saved_user_restores_identity_without_restoring_old_session(client):
    first = join(client, "Pree")
    second = join(client, "Alex", first["token"])
    directory = client.get("/api/guest/users").json()
    assert directory["storage"] == "local"
    assert {row["id"] for row in directory["users"]} == {first["member"]["id"], second["member"]["id"]}
    response = client.post("/api/guest/session", json={"user_id": first["member"]["id"]}, headers=headers(second))
    assert response.status_code == 200
    restored = response.json()
    assert restored["member"] == first["member"]
    assert restored["token"] != first["token"]
    assert client.get("/api/me", headers=headers(second)).status_code == 401
    assert client.get("/api/me", headers=headers(first)).status_code == 401
    assert len(client.get("/api/guest/users").json()["users"]) == 2


def test_temporary_users_reset_on_restart_without_erasing_shared_object_history(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path))) as first:
        guest = join(first, "Temporary tester")
        first.post("/api/objects/keys/notes", headers=headers(guest),
                   json={"room": "Kitchen", "location": "Keep this evidence", "kind": "moved"})
    with TestClient(create_app(Settings(data_dir=tmp_path))) as second:
        assert second.get("/api/guest/users").json()["users"] == []
        assert second.get("/api/me", headers=headers(guest)).status_code == 401
        visitor = join(second, "Next tester")
        assert visitor["member"]["id"] != guest["member"]["id"]
        item = second.get("/api/objects?q=keys", headers=headers(visitor)).json()["objects"][0]
        assert item["latest"]["location"] == "Keep this evidence"
        assert "actor_name" not in item["latest"]


def test_missing_or_invalid_saved_user_never_creates_an_identity(client):
    assert client.post("/api/guest/session", json={"user_id": "guest-" + "f" * 32}).status_code == 404
    assert client.post("/api/guest/session", json={"user_id": "pree"}).status_code == 422
    assert client.post("/api/guest/session", json={"user_id": "guest-" + "f" * 32, "name": "Pree"}).status_code == 422
    assert client.get("/api/guest/users").json()["users"] == []


def test_prototype_mode_uses_guests_and_disables_fixed_identity_selection(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path, app_env="prototype"))) as client:
        assert client.get("/api/health").json()["auth_mode"] == "guest"
        assert client.post("/api/demo/session", json={"profile": "pree"}).status_code == 404
        guest = join(client, "Prototype visitor")
        assert client.get("/api/objects", headers=headers(guest)).status_code == 200
