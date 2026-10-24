from fastapi.testclient import TestClient
import httpx

from commonplace_api.connector_gateway import create_gateway


TOKEN = "mock-session-token-for-gateway-tests-123456789"


def test_gateway_requires_credential_before_contacting_backend():
    def backend(request):
        raise AssertionError("An unauthorized request must not reach the backend")

    with TestClient(create_gateway(TOKEN, httpx.MockTransport(backend))) as client:
        assert client.get("/api/connector/search?q=keys").status_code == 401
        assert client.get("/api/connector/search?q=keys", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_gateway_only_exposes_search_and_its_schema():
    with TestClient(create_gateway(TOKEN)) as client:
        paths = client.get("/openapi.json").json()["paths"]
        assert list(paths) == ["/api/connector/search"]
        assert "post" not in paths["/api/connector/search"]
        for path in ["/api/demo/session", "/api/demo/captures", "/api/captures", "/api/objects/keys/notes"]:
            assert client.post(path, json={}).status_code == 404
        assert client.get("/api/images/demo-scene").status_code == 404


def test_gateway_forwards_authenticated_search_only():
    def backend(request):
        assert request.method == "GET"
        assert str(request.url) == "http://127.0.0.1:8000/api/connector/search?q=HDMI+adapter"
        assert request.headers["Authorization"] == f"Bearer {TOKEN}"
        return httpx.Response(200, json={"query": "HDMI adapter", "matches": [], "needs_disambiguation": False,
                                          "guidance": "No stored match"})

    with TestClient(create_gateway(TOKEN, httpx.MockTransport(backend))) as client:
        response = client.get("/api/connector/search?q=HDMI%20adapter", headers={"Authorization": f"Bearer {TOKEN}"})
        assert response.status_code == 200
        assert response.json()["matches"] == []


def test_gateway_fails_closed_without_configuration():
    with TestClient(create_gateway("")) as client:
        assert client.get("/api/connector/search?q=keys").status_code == 503


def test_gateway_reports_expired_session():
    with TestClient(create_gateway(TOKEN, httpx.MockTransport(lambda request: httpx.Response(401)))) as client:
        response = client.get("/api/connector/search?q=keys", headers={"Authorization": f"Bearer {TOKEN}"})
        assert response.status_code == 401
        assert "expired" in response.json()["detail"]


def test_gateway_reads_real_backend_state_after_another_members_update(tmp_path):
    from commonplace_api.config import Settings
    from commonplace_api.main import create_app

    with TestClient(create_app(Settings(data_dir=tmp_path))) as backend:
        token = backend.post("/api/demo/session", json={"profile": "pree"}).json()["token"]
        alex = backend.post("/api/demo/session", json={"profile": "alex"}).json()["token"]

        def forward(request):
            response = backend.get(str(request.url), headers={"Authorization": request.headers["Authorization"]})
            return httpx.Response(response.status_code, json=response.json())

        with TestClient(create_gateway(token, httpx.MockTransport(forward))) as gateway:
            headers = {"Authorization": f"Bearer {token}"}
            first = gateway.get("/api/connector/search?q=adapter", headers=headers)
            assert first.status_code == 200
            assert first.json()["matches"][0]["latest"]["source"] == "sample"
            update = backend.post("/api/objects/adapter/notes", headers={"Authorization": f"Bearer {alex}"},
                                  json={"room": "Kitchen", "location": "In the green box", "kind": "moved"})
            assert update.status_code == 201
            latest = gateway.get("/api/connector/search?q=adapter", headers=headers).json()["matches"][0]["latest"]
            assert latest["source"] == "reported"
            assert "actor_name" not in latest and "actor_id" not in latest
            assert latest["location"] == "In the green box"
