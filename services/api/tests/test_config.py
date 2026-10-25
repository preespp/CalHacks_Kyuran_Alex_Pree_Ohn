import pytest

from commonplace_api.config import Settings


def test_split_credentials_load_from_environment_and_override_shared_fallback(tmp_path, monkeypatch):
    for key, value in {
        "APP_ENV": "development", "DATA_DIR": str(tmp_path), "STORAGE_PROVIDER": "local",
        "ASSISTANT_PROVIDER": "gemini", "VISION_PROVIDER": "gemini",
        "GEMINI_CHAT_API_KEY": "chat-test-key", "GEMINI_VISION_API_KEY": "vision-test-key",
        "GEMINI_API_KEY": "legacy-test-key", "GEMINI_CHAT_MODEL": "chat-model", "GEMINI_MODEL": "vision-model",
    }.items():
        monkeypatch.setenv(key, value)
    settings = Settings.from_env()
    settings.validate()
    assert settings.chat_api_key == "chat-test-key"
    assert settings.vision_api_key == "vision-test-key"


def test_legacy_shared_key_remains_supported(tmp_path):
    settings = Settings(data_dir=tmp_path, gemini_api_key="shared-test-key", gemini_model="test",
                        assistant_provider="gemini", vision_provider="gemini")
    settings.validate()
    assert settings.chat_api_key == settings.vision_api_key == "shared-test-key"


def test_chat_can_be_enabled_without_vision_credentials(tmp_path):
    settings = Settings(data_dir=tmp_path, assistant_provider="gemini", gemini_chat_api_key="chat-test-key",
                        gemini_chat_model="chat-model")
    settings.validate()
    assert settings.vision_provider == "demo"
    assert settings.vision_api_key == ""


def test_vision_can_be_enabled_without_chat_credentials(tmp_path):
    settings = Settings(data_dir=tmp_path, vision_provider="gemini", gemini_vision_api_key="vision-test-key",
                        gemini_model="vision-model")
    settings.validate()
    assert settings.assistant_provider == "disabled"
    assert settings.chat_api_key == ""


@pytest.mark.parametrize("fields,missing", [
    ({"assistant_provider": "gemini", "gemini_vision_api_key": "vision-test-key", "gemini_chat_model": "chat-model"}, "GEMINI_CHAT_API_KEY"),
    ({"vision_provider": "gemini", "gemini_chat_api_key": "chat-test-key", "gemini_model": "vision-model"}, "GEMINI_VISION_API_KEY"),
])
def test_one_role_never_silently_borrows_the_other_roles_key(tmp_path, fields, missing):
    with pytest.raises(RuntimeError, match=missing):
        Settings(data_dir=tmp_path, **fields).validate()
