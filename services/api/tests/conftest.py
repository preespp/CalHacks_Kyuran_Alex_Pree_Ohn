"""Keep direct pytest runs independent of a developer's live .env configuration."""

import os
import tempfile

_STATE = {}
_DATA = None
_SETTINGS = {
    'APP_ENV': 'development', 'MEMORY_PROVIDER': 'sqlite',
    'SEED_SAMPLE_DATA': 'false', 'GUEST_PROFILE_STORE': 'local',
    'CAMERA_FRAME_SINK': 'disabled', 'ASSISTANT_PROVIDER': 'disabled',
    'VISION_PROVIDER': 'demo', 'VISION_ENRICHMENT': 'geometry', 'STORAGE_PROVIDER': 'local',
    'MODEL_API_KEY': '', 'META_MODEL': '', 'GEMINI_API_KEY': '',
    'GEMINI_VISION_API_KEY': '', 'GEMINI_CHAT_API_KEY': '',
    'SPACETIMEDB_SERVER_TOKEN': '', 'CAMERA_SPACETIMEDB_TOKEN': '',
    'COMMONPLACE_CONNECTOR_TOKEN': '',
}


def pytest_configure(config):
    global _DATA
    _DATA = tempfile.TemporaryDirectory(prefix='remi-pytest-')
    settings = {**_SETTINGS, 'DATA_DIR': _DATA.name}
    for name, value in settings.items():
        _STATE[name] = os.environ.get(name)
        os.environ[name] = value


def pytest_unconfigure(config):
    for name, original in _STATE.items():
        if original is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = original
    if _DATA is not None:
        _DATA.cleanup()
