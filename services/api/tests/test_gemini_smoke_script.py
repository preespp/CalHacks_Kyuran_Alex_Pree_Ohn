import importlib.util
import json

import httpx
import pytest

from commonplace_api.config import ROOT

spec = importlib.util.spec_from_file_location("gemini_smoke", ROOT / "scripts" / "test_gemini_api.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


@pytest.fixture(autouse=True)
def assistant_environment(monkeypatch):
    monkeypatch.setenv("GEMINI_CHAT_API_KEY", "mock-chat-secret")
    monkeypatch.setenv("GEMINI_VISION_API_KEY", "mock-vision-secret-must-not-be-used")
    monkeypatch.setenv("GEMINI_API_KEY", "mock-legacy-secret-must-not-be-used")
    monkeypatch.setenv("GEMINI_CHAT_MODEL", "test-chat")
    # This check must not validate or initialize the rest of the app.
    monkeypatch.setenv("VISION_PROVIDER", "gemini")
    monkeypatch.setenv("STORAGE_PROVIDER", "not-configured-for-this-test")


def test_text_check_uses_only_assistant_credentials_and_prints_no_key(monkeypatch, capsys):
    def respond(url, **kwargs):
        assert url.endswith("/models/test-chat:generateContent")
        assert kwargs["headers"] == {"x-goog-api-key": "mock-chat-secret"}
        assert "mock-chat-secret" not in url
        assert kwargs["follow_redirects"] is False
        return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [
            {"thought": True, "text": "hidden"}, {"text": "GEMINI_API_OK"}]}}]})
    monkeypatch.setattr(smoke.httpx, "post", respond)
    assert smoke.main([]) == 0
    output = capsys.readouterr().out
    assert "PASS" in output and "mock-chat-secret" not in output and "hidden" not in output


def test_tool_check_uses_real_adapter_with_synthetic_data(monkeypatch, capsys):
    original = httpx.AsyncClient
    requests = []
    tool = {"role": "model", "parts": [{"functionCall": {"name": "search_household_memory", "args": {"q": "test keys"}}, "thoughtSignature": "opaque"}]}

    def respond(request):
        assert request.headers["x-goog-api-key"] == "mock-chat-secret"
        payload = json.loads(request.content)
        requests.append(payload)
        if len(requests) == 1:
            content = tool
        else:
            assert payload["contents"][-2] == tool
            evidence = payload["contents"][-1]["parts"][0]["functionResponse"]["response"]["matches"][0]
            assert evidence["latest"]["location"] == "In the green test box"
            content = {"role": "model", "parts": [{"text": "Test teammate reported the test keys in the green test box, Kitchen."}]}
        return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": content}]})

    monkeypatch.setattr(smoke.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(respond), **kwargs))
    assert smoke.main(["--tools"]) == 0
    assert len(requests) == 2
    output = capsys.readouterr().out
    assert "PASS" in output and "synthetic" in output
    assert "mock-chat-secret" not in output


@pytest.mark.parametrize("status", [400, 403, 404, 429, 500])
def test_http_failures_are_sanitized_and_not_retried(monkeypatch, capsys, status):
    calls = []
    def reject(*args, **kwargs):
        calls.append(1)
        return httpx.Response(status, json={"error": {"message": "sensitive-upstream-detail"}})
    monkeypatch.setattr(smoke.httpx, "post", reject)
    assert smoke.main([]) == 1
    assert len(calls) == 1
    output = capsys.readouterr().out
    assert "FAIL" in output and "sensitive-upstream-detail" not in output


@pytest.mark.parametrize("payload", [{"candidates": []}, {"candidates": [{"finishReason": "MAX_TOKENS"}]},
    {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "different answer"}]}}]}])
def test_invalid_or_incomplete_text_is_not_reported_as_a_pass(monkeypatch, payload):
    monkeypatch.setattr(smoke.httpx, "post", lambda *args, **kwargs: httpx.Response(200, json=payload))
    assert smoke.main([]) == 1


def test_missing_chat_credentials_do_not_use_vision_key(monkeypatch, capsys):
    monkeypatch.delenv("GEMINI_CHAT_API_KEY")
    monkeypatch.delenv("GEMINI_API_KEY")
    monkeypatch.setattr(smoke.httpx, "post", lambda *args, **kwargs: pytest.fail("No network call without credentials"))
    assert smoke.main([]) == 1
    assert "No request was sent" in capsys.readouterr().out


def test_invalid_model_id_is_rejected_before_network(monkeypatch):
    monkeypatch.setenv("GEMINI_CHAT_MODEL", "models/invalid")
    monkeypatch.setattr(smoke.httpx, "post", lambda *args, **kwargs: pytest.fail("No network call with invalid model ID"))
    assert smoke.main([]) == 1
