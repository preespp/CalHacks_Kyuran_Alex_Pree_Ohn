import asyncio
import json

import httpx
import pytest

from commonplace_api.config import Settings
from commonplace_api.vision import VisionError, detect


def mock_gemini(monkeypatch, response_data, status=200):
    original = httpx.AsyncClient

    def respond(request):
        assert request.headers["x-goog-api-key"] == "test-secret"
        assert "test-secret" not in str(request.url)
        payload = json.loads(request.content)
        assert payload["contents"][0]["parts"][1]["inlineData"]["mimeType"] == "image/jpeg"
        return httpx.Response(status, json=response_data)

    monkeypatch.setattr("commonplace_api.vision.httpx.AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(respond), **kwargs))


def test_gemini_converts_documented_yx_coordinates(tmp_path, monkeypatch):
    output = {"objects": [{"label": "Adapter", "appearance": "Silver", "location": "On the desk", "box_2d": [200, 100, 500, 400]}]}
    mock_gemini(monkeypatch, {"candidates": [{"content": {"parts": [{"text": json.dumps(output)}]}}]})
    result = asyncio.run(detect(Settings(data_dir=tmp_path, gemini_api_key="legacy-key-must-not-be-used",
                                         gemini_chat_api_key="chat-key-must-not-be-used", gemini_vision_api_key="test-secret",
                                         gemini_model="test"), b"image", "Office"))
    assert result[0].bbox == [.1, .2, .4, .5]


@pytest.mark.parametrize("payload", [
    {"candidates": []},
    {"candidates": [{"content": {"parts": [{"text": "not json"}]}}]},
    {"candidates": [{"content": {"parts": [{"text": json.dumps({"objects": [{"label": "Adapter", "appearance": "Silver", "location": "Desk", "box_2d": [100, 100, 1100, 500]}]})}]}}]},
])
def test_invalid_provider_output_is_not_saved(tmp_path, monkeypatch, payload):
    mock_gemini(monkeypatch, payload)
    with pytest.raises(VisionError):
        asyncio.run(detect(Settings(data_dir=tmp_path, gemini_api_key="test-secret", gemini_model="test"), b"image", "Office"))
