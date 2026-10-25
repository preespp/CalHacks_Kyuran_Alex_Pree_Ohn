import importlib.util

import httpx

from commonplace_api.config import ROOT

spec = importlib.util.spec_from_file_location("meta_smoke", ROOT / "scripts" / "test_meta_api.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


def test_manual_model_test_uses_meta_endpoint_without_printing_credentials(monkeypatch, capsys):
    secret = "mock-meta-key-not-a-real-key"
    monkeypatch.setenv("MODEL_API_KEY", secret)
    monkeypatch.setenv("META_MODEL", "test-model")

    def respond(url, **kwargs):
        assert url == "https://api.meta.ai/v1/responses"
        assert kwargs["headers"]["Authorization"] == f"Bearer {secret}"
        assert kwargs["json"]["max_output_tokens"] == 4096
        assert kwargs["json"]["store"] is False
        return httpx.Response(200, json={"output": [{"type": "message", "content": [
            {"type": "output_text", "text": "META_API_OK"}]}], "usage": {"input_tokens": 10, "output_tokens": 5}})

    monkeypatch.setattr(smoke.httpx, "post", respond)
    assert smoke.main() == 0
    output = capsys.readouterr().out
    assert "PASS" in output
    assert secret not in output
    assert "not a Muse connector" in output


def test_manual_model_test_does_not_retry_a_failed_credential(monkeypatch, capsys):
    monkeypatch.setenv("MODEL_API_KEY", "mock-key")
    monkeypatch.setenv("META_MODEL", "test-model")
    calls = []

    def reject(*args, **kwargs):
        calls.append(1)
        return httpx.Response(401)

    monkeypatch.setattr(smoke.httpx, "post", reject)
    assert smoke.main() == 1
    assert len(calls) == 1
    assert "Check the API key" in capsys.readouterr().out
