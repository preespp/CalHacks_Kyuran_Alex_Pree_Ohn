import json

from fastapi.testclient import TestClient
import httpx
import pytest

from commonplace_api.config import Settings
from commonplace_api.guest_profiles import create_profiles
from commonplace_api.main import create_app
from commonplace_api.store import Store


def remote_settings(tmp_path, **extra):
    return Settings(data_dir=tmp_path, spacetime_url="https://users.example.test",
                    spacetime_database="prototype-users", spacetime_token="mock-private-server-token", **extra)


def mock_server(monkeypatch, handler):
    original = httpx.Client
    def respond(request):
        assert request.url.host == "users.example.test"
        assert request.headers["Authorization"] == "Bearer mock-private-server-token"
        assert "mock-private-server-token" not in str(request.url)
        return handler(request)
    monkeypatch.setattr("commonplace_api.guest_profiles.httpx.Client",
                        lambda **kwargs: original(transport=httpx.MockTransport(respond), **kwargs))


def test_spacetime_saved_users_survive_api_restart_and_can_be_reselected(tmp_path, monkeypatch):
    rows = []
    def respond(request):
        if request.method == "GET":
            return httpx.Response(200, json={"database_identity": "test-database"})
        if request.url.path.endswith("/sql"):
            assert request.headers["Content-Type"] == "text/plain"
            assert request.content.decode() == "SELECT id, household_id, name FROM guest_profile WHERE household_id = 'demo-home'"
            return httpx.Response(200, json=[{"rows": rows}])
        assert request.url.path.endswith("/call/create_guest_profile")
        user_id, name = json.loads(request.content)
        rows.append([user_id, "demo-home", name])
        return httpx.Response(200)
    mock_server(monkeypatch, respond)
    settings = remote_settings(tmp_path)
    with TestClient(create_app(settings)) as first:
        profile = first.post("/api/guest/session", json={"name": "Pree"}).json()["member"]
        assert first.get("/api/guest/users").json()["storage"] == "spacetimedb"
    with TestClient(create_app(settings)) as second:
        directory = second.get("/api/guest/users").json()
        assert directory["users"] == [profile]
        assert "mock-private-server-token" not in json.dumps(directory)
        selected = second.post("/api/guest/session", json={"user_id": profile["id"]}).json()
        assert selected["member"] == profile
        assert len(rows) == 1


def test_auto_uses_temporary_profiles_when_remote_database_does_not_exist(tmp_path, monkeypatch):
    mock_server(monkeypatch, lambda request: httpx.Response(404))
    with TestClient(create_app(remote_settings(tmp_path))) as client:
        assert client.get("/api/guest/users").json()["storage"] == "local"
        assert client.post("/api/guest/session", json={"name": "Local tester"}).status_code == 200


@pytest.mark.parametrize("failure", [401, 403, 500])
def test_configured_registry_errors_do_not_silently_replace_saved_users(tmp_path, monkeypatch, failure):
    mock_server(monkeypatch, lambda request: httpx.Response(failure))
    with TestClient(create_app(remote_settings(tmp_path))) as client:
        assert client.get("/api/guest/users").status_code == 503
        assert client.post("/api/guest/session", json={"name": "Do not lose this user"}).status_code == 503
        assert client.get("/api/health").json()["guest_profile_store"] == "spacetimedb"


def test_missing_profile_schema_is_reported_without_local_fallback(tmp_path, monkeypatch):
    mock_server(monkeypatch, lambda request: httpx.Response(200, json={}) if request.method == "GET" else httpx.Response(400))
    with TestClient(create_app(remote_settings(tmp_path))) as client:
        response = client.get("/api/guest/users")
        assert response.status_code == 503
        assert "guest_profile" in response.json()["detail"]


def test_explicit_remote_mode_does_not_fall_back_when_database_is_missing(tmp_path, monkeypatch):
    mock_server(monkeypatch, lambda request: httpx.Response(404))
    with TestClient(create_app(remote_settings(tmp_path, guest_profile_store="spacetimedb"))) as client:
        assert client.get("/api/guest/users").status_code == 503


def test_local_mode_never_attempts_remote_requests_even_if_other_settings_exist(tmp_path, monkeypatch):
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: pytest.fail("Local profiles must not connect to a database"))
    store = Store(tmp_path / "memory.sqlite3")
    profiles = create_profiles(remote_settings(tmp_path, guest_profile_store="local"), store)
    assert profiles.provider == "local"
    assert profiles.create("Pree")["name"] == "Pree"


@pytest.mark.parametrize("url", ["https://key:secret@example.test", "https://example.test/path", "http://example.test", "wss://example.test"])
def test_server_token_cannot_be_sent_to_an_insecure_or_credential_embedded_origin(tmp_path, url):
    with pytest.raises(RuntimeError):
        Settings(data_dir=tmp_path, spacetime_url=url, spacetime_database="users", spacetime_token="test").validate()


@pytest.mark.parametrize('configured_token', ['', 'unused-private-token'])
def test_public_guest_table_works_without_owner_credentials_and_preserves_ids(tmp_path, monkeypatch, configured_token):
    original = httpx.Client
    rows = []
    def respond(request):
        assert 'Authorization' not in request.headers
        assert request.url.host == 'public-guests.example.test'
        if request.method == 'GET':
            return httpx.Response(200, json={'database_identity': 'public-prototype'})
        if request.url.path.endswith('/sql'):
            assert request.content.decode() == "SELECT id, household_id, name FROM guest_profile WHERE household_id = 'demo-home'"
            return httpx.Response(200, json=[{'rows': rows}])
        assert request.url.path.endswith('/call/create_guest_profile')
        user_id, name = json.loads(request.content)
        rows.append([user_id, 'demo-home', name])
        return httpx.Response(200)
    monkeypatch.setattr('commonplace_api.guest_profiles.httpx.Client', lambda **kwargs: original(transport=httpx.MockTransport(respond), **kwargs))
    settings = Settings(data_dir=tmp_path, guest_profile_store='auto', spacetime_profile_access='public',
                        spacetime_url='https://public-guests.example.test', spacetime_database='prototype', spacetime_token=configured_token)
    with TestClient(create_app(settings)) as first:
        assert first.get('/api/guest/users').json()['storage'] == 'spacetimedb'
        member = first.post('/api/guest/session', json={'name': 'Pree'}).json()['member']
    with TestClient(create_app(settings)) as second:
        users = second.get('/api/guest/users').json()['users']
        assert users == [member]
        assert second.post('/api/guest/session', json={'user_id': member['id']}).json()['member'] == member
        assert len(rows) == 1


def test_public_existing_database_without_guest_table_shows_missing_schema(tmp_path, monkeypatch):
    original = httpx.Client
    def respond(request):
        assert 'Authorization' not in request.headers
        return httpx.Response(200, json={}) if request.method == 'GET' else httpx.Response(400)
    monkeypatch.setattr('commonplace_api.guest_profiles.httpx.Client', lambda **kwargs: original(transport=httpx.MockTransport(respond), **kwargs))
    settings = Settings(data_dir=tmp_path, spacetime_profile_access='public', spacetime_url='https://public-guests.example.test', spacetime_database='prototype')
    with TestClient(create_app(settings)) as client:
        response = client.get('/api/guest/users')
        assert response.status_code == 503
        assert 'guest_profile' in response.json()['detail']
        assert client.post('/api/guest/session', json={'name': 'No phantom user'}).status_code == 503


def test_private_registry_still_requires_token_and_unknown_access_mode_is_rejected(tmp_path):
    with pytest.raises(RuntimeError, match='TOKEN'):
        Settings(data_dir=tmp_path, guest_profile_store='spacetimedb', spacetime_url='https://users.example.test', spacetime_database='users').validate()
    with pytest.raises(RuntimeError, match='PROFILE_ACCESS'):
        Settings(data_dir=tmp_path, spacetime_profile_access='invalid').validate()
