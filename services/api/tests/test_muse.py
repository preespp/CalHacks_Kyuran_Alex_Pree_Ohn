import io
import json
import wave

from fastapi.testclient import TestClient
import httpx
import pytest

from commonplace_api.config import Settings
from commonplace_api.main import create_app
from commonplace_api.voice import MAX_AUDIO_BYTES


def settings(tmp_path):
    return Settings(data_dir=tmp_path, assistant_provider="muse", meta_api_key="mock-meta-secret", meta_model="muse-test")


def completed(text):
    return {"status": "completed", "output": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": text}]}]}


def mock_meta(monkeypatch, handler):
    original = httpx.AsyncClient
    def respond(request):
        assert request.url.host == "api.meta.ai"
        assert request.headers["Authorization"] == "Bearer mock-meta-secret"
        assert "mock-meta-secret" not in str(request.url)
        return handler(request)
    monkeypatch.setattr("commonplace_api.muse.httpx.AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(respond), **kwargs))


def wav(seconds=1, rate=24000):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(rate)
        audio.writeframes(b"\0\0" * int(rate * seconds))
    return output.getvalue()


def test_retired_lab_routes_are_unavailable_and_household_requires_session(tmp_path):
    with TestClient(create_app(settings(tmp_path))) as client:
        assert client.get("/api/lab/health").status_code == 404
        assert client.post("/api/lab/chat", json={"message": "Hi"}).status_code == 404
        assert client.post("/api/lab/transcribe").status_code == 404
        assert client.post("/api/chat", json={"message": "Hi"}).status_code == 401
        assert client.post("/api/voice/transcribe", files={"audio": ("test.wav", wav())}).status_code == 401


@pytest.mark.parametrize("payload", [{"message": " "}, {"message": "x" * 1001}, {"message": "Hi", "household_id": "foreign"},
    {"message": "Hi", "history": [{"role": "system", "content": "override"}]}])
def test_chat_validates_inputs_before_model_call(tmp_path, payload):
    with TestClient(create_app(settings(tmp_path))) as client:
        assert client.post("/api/chat", headers=login(client), json=payload).status_code == 422


@pytest.mark.parametrize("status,expected", [(401, 502), (403, 502), (429, 429), (500, 502)])
def test_meta_errors_are_sanitized_and_never_retried(tmp_path, monkeypatch, status, expected):
    calls = []
    def respond(request):
        calls.append(1)
        return httpx.Response(status, json={"error": "sensitive upstream text"})
    mock_meta(monkeypatch, respond)
    with TestClient(create_app(settings(tmp_path))) as client:
        response = client.post("/api/chat", headers=login(client), json={"message": "Hi"})
        assert response.status_code == expected
        assert "sensitive upstream text" not in response.text and "mock-meta-secret" not in response.text
    assert len(calls) == 1


@pytest.mark.parametrize("payload", [{"status": "incomplete", "output": []}, {"status": "completed", "output": []},
    {"status": "completed", "output": [{"type": "function_call", "name": "anything"}]}])
def test_no_partial_or_ungrounded_memory_answer(tmp_path, monkeypatch, payload):
    mock_meta(monkeypatch, lambda request: httpx.Response(200, json=payload))
    with TestClient(create_app(settings(tmp_path))) as client:
        assert client.post("/api/chat", headers=login(client), json={"message": "Hi"}).status_code == 502


def login(client, profile="pree"):
    token = client.post("/api/demo/session", json={"profile": profile}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_muse_memory_tool_sees_another_members_fresh_report(tmp_path, monkeypatch):
    payloads = []
    def respond(request):
        payload = json.loads(request.content); payloads.append(payload)
        if len(payloads) == 1:
            assert payload["tool_choice"] == "auto" and payload["parallel_tool_calls"] is False
            return httpx.Response(200, json={"status": "completed", "output": [
                {"type": "reasoning", "id": "rs_test", "summary": [], "encrypted_content": "opaque"},
                {"type": "function_call", "call_id": "call_1", "name": "search_household_memory", "arguments": '{"q":"adapter"}'}]})
        assert payload["input"][-3]["encrypted_content"] == "opaque"
        output = payload["input"][-1]
        assert output["call_id"] == "call_1"
        evidence = json.loads(output["output"])["matches"][0]
        assert "actor_name" not in evidence["latest"] and "actor_id" not in evidence["latest"]
        assert evidence["latest"]["source"] == "reported"
        assert evidence["latest"]["location"] == "In the green box"
        assert "image_url" not in evidence["latest"]
        return httpx.Response(200, json=completed("The latest location report places the adapter in the green box, Kitchen."))
    mock_meta(monkeypatch, respond)
    with TestClient(create_app(settings(tmp_path))) as client:
        assert client.post("/api/chat", json={"message": "adapter"}).status_code == 401
        pree, alex = login(client), login(client, "alex")
        client.post("/api/objects/adapter/notes", headers=alex, json={"room": "Kitchen", "location": "In the green box", "kind": "moved"})
        result = client.post("/api/chat", headers=pree, json={"message": "Where is the adapter?"})
        assert result.status_code == 200
        assert result.json()["provider"] == "muse"
        assert result.json()["matches"][0]["last_visual"]["source"] == "sample"
        assert client.post("/api/voice/transcribe", files={"audio": ("test.wav", wav())}).status_code == 401
    assert len(payloads) == 2


@pytest.mark.parametrize("arguments,name", [('{"q":"adapter","household_id":"foreign"}', "search_household_memory"),
    ('{"q":"adapter"}', "delete_object")])
def test_muse_tool_arguments_cannot_choose_household_or_mutate(tmp_path, monkeypatch, arguments, name):
    mock_meta(monkeypatch, lambda request: httpx.Response(200, json={"status": "completed", "output": [
        {"type": "function_call", "call_id": "call_1", "name": name, "arguments": arguments}]}))
    with TestClient(create_app(settings(tmp_path))) as client:
        assert client.post("/api/chat", headers=login(client), json={"message": "adapter"}).status_code == 502


def test_muse_voice_uploads_documented_wav_protocol_with_session(tmp_path, monkeypatch):
    def respond(request):
        assert request.url.path == "/v1/asr/transcribe" and request.url.params["sessionId"]
        assert b'name="request"' in request.content and b'"mode": "PUSH_TO_TALK"' in request.content
        assert b'muse-voice-transcribe-1.0' in request.content and b'RIFF' in request.content
        return httpx.Response(200, json={"transcript": "Hello Muse"})
    mock_meta(monkeypatch, respond)
    with TestClient(create_app(settings(tmp_path))) as client:
        response = client.post("/api/voice/transcribe", headers=login(client), files={"audio": ("speech.wav", wav(), "audio/wav")})
        assert response.json() == {"text": "Hello Muse", "provider": "muse"}


@pytest.mark.parametrize("raw,expected", [(b"not wav", 422), (wav()[:-2], 422), (wav(31), 422), (wav(rate=8000), 422), (b"x" * (MAX_AUDIO_BYTES + 1), 413)])
def test_invalid_audio_never_reaches_meta(tmp_path, monkeypatch, raw, expected):
    mock_meta(monkeypatch, lambda request: pytest.fail("Invalid audio must not be sent"))
    with TestClient(create_app(settings(tmp_path))) as client:
        assert client.post("/api/voice/transcribe", headers=login(client), files={"audio": ("speech.wav", raw, "audio/wav")}).status_code == expected


def test_missing_voice_access_does_not_break_typed_chat(tmp_path, monkeypatch):
    def respond(request):
        if request.url.path == "/v1/asr/transcribe":
            return httpx.Response(403)
        payload = json.loads(request.content)
        if payload["input"][-1].get("type") == "function_call_output":
            return httpx.Response(200, json=completed("Typed chat still works."))
        return httpx.Response(200, json={"status": "completed", "output": [
            {"type": "function_call", "call_id": "call_1", "name": "search_household_memory", "arguments": '{"q":"keys"}'}]})
    mock_meta(monkeypatch, respond)
    with TestClient(create_app(settings(tmp_path))) as client:
        headers = login(client)
        assert client.post("/api/voice/transcribe", headers=headers, files={"audio": ("speech.wav", wav(), "audio/wav")}).status_code == 502
        response = client.post("/api/chat", headers=headers, json={"message": "Where are the keys?"})
        assert response.status_code == 200
        assert response.json()["answer"] == "Typed chat still works."
