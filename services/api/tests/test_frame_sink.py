import hashlib
import io
import json
import time

from fastapi.testclient import TestClient
import httpx
from PIL import Image
import pytest

from commonplace_api.config import Settings
from commonplace_api.main import create_app
from commonplace_api.models import Detection


def jpeg():
    output = io.BytesIO()
    Image.new('RGB', (100, 80), 'red').save(output, format='JPEG')
    return output.getvalue()


def settings(tmp_path, **extra):
    return Settings(data_dir=tmp_path, guest_profile_store='local', camera_frame_sink='spacetimedb',
                    camera_spacetime_url='https://image-db.example.test', camera_spacetime_database='team-images',
                    spacetime_database='guest-registry', spacetime_token='guest-secret-never-forward', **extra)


def mock_sink(monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setattr('commonplace_api.frame_sink.httpx.AsyncClient',
                        lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))


@pytest.mark.parametrize('image_token', ['', 'mock-image-secret'])
def test_camera_uploads_normalized_frames_with_separate_credentials_and_no_model(tmp_path, monkeypatch, image_token):
    requests = []
    def respond(request):
        assert request.url.host == 'image-db.example.test'
        assert request.url.path == '/v1/database/team-images/call/upload_binary_frame'
        assert 'guest-secret-never-forward' not in str(request.headers)
        if image_token:
            assert request.headers['Authorization'] == f'Bearer {image_token}'
        else:
            assert 'Authorization' not in request.headers
        requests.append(json.loads(request.content))
        return httpx.Response(200)
    async def no_model(*args):
        pytest.fail('Upload-only mode must not call Gemini')
    monkeypatch.setattr('commonplace_api.main.detect', no_model)
    mock_sink(monkeypatch, respond)
    with TestClient(create_app(settings(tmp_path, camera_spacetime_token=image_token))) as client:
        token = client.post('/api/guest/session', json={'name': 'Uploader'}).json()['token']
        headers = {'Authorization': f'Bearer {token}'}
        objects = client.get('/api/objects', headers=headers).json()
        for sequence in [1, 2]:
            response = client.post('/api/camera/frames', headers=headers, data={'scan_id': 'database-scan-1'},
                                   files={'image': ('frame.jpg', jpeg(), 'image/jpeg')})
            assert response.status_code == 200
            assert response.json()['image_upload'] == {
                'provider': 'spacetimedb', 'state': 'uploaded',
                'session': hashlib.sha256(json.dumps(["demo-home", "database-scan-1"]).encode()).hexdigest()[:32], 'sequence': sequence,
            }
            assert response.json()['analysis']['state'] == 'disabled'
        assert client.get('/api/health').json()['camera_frame_sink'] == 'spacetimedb'
        assert client.get('/api/objects', headers=headers).json() == objects
        assert not list(tmp_path.glob('**/*.jpg'))
    assert len(requests) == 2
    for sequence, body in enumerate(requests, 1):
        session, seq, captured_us, width, height, encoded = body
        assert session == hashlib.sha256(json.dumps(["demo-home", "database-scan-1"]).encode()).hexdigest()[:32]
        assert seq == sequence
        assert isinstance(captured_us, int) and captured_us > 1_000_000_000_000
        image = Image.open(io.BytesIO(bytes(encoded)))
        assert image.format == 'JPEG' and image.size == (width, height) == (100, 80)


def test_uploaded_camera_frame_still_flows_through_gemini_and_retained_evidence(tmp_path, monkeypatch):
    order = []
    def respond(request):
        order.append('upload')
        return httpx.Response(200)
    async def detect(*args):
        order.append('vision')
        return [Detection(label='Cup', appearance='A red cup', location='On the desk', bbox=[.1, .1, .5, .5])]
    mock_sink(monkeypatch, respond)
    monkeypatch.setattr('commonplace_api.main.detect', detect)
    with TestClient(create_app(settings(tmp_path, vision_provider='gemini', gemini_vision_api_key='mock', gemini_model='mock'))) as client:
        token = client.post('/api/guest/session', json={'name': 'Scanner'}).json()['token']
        headers = {'Authorization': f'Bearer {token}'}
        response = client.post('/api/camera/frames', headers=headers,
                               data={'scan_id': 'gemini-db-scan-1', 'memory_enabled': 'true'},
                               files={'image': ('frame.jpg', jpeg(), 'image/jpeg')})
        assert response.status_code == 200
        for _ in range(100):
            state = client.get('/api/camera/streams/gemini-db-scan-1', headers=headers).json()
            if state['processed_frames']:
                break
            time.sleep(.005)
        assert state['processed_frames'] == 1
        assert order == ['upload', 'vision']
        item = client.get('/api/objects?q=cup', headers=headers).json()['objects'][0]
        assert item['latest']['source'] == 'gemini'
        assert client.get(item['latest']['image_url'], headers=headers).status_code == 200


@pytest.mark.parametrize('failure', [401, 403, 404, 500, 530, 302, 'timeout'])
def test_upload_failures_are_visible_without_model_calls_or_provider_body_leaks(tmp_path, monkeypatch, failure):
    def respond(request):
        if failure == 'timeout':
            raise httpx.ConnectTimeout('private-image-token', request=request)
        if failure == 530:
            return httpx.Response(530, text='Capture backend only')
        return httpx.Response(failure, text='private-image-token and image bytes', headers={'Location': 'https://another.test'})
    async def no_model(*args):
        pytest.fail('Do not run Gemini after an unconfirmed upload')
    mock_sink(monkeypatch, respond)
    monkeypatch.setattr('commonplace_api.main.detect', no_model)
    with TestClient(create_app(settings(tmp_path, vision_provider='gemini', gemini_vision_api_key='mock', gemini_model='mock'))) as client:
        token = client.post('/api/guest/session', json={'name': 'Scanner'}).json()['token']
        headers = {'Authorization': f'Bearer {token}'}
        before = client.get('/api/objects', headers=headers).json()
        response = client.post('/api/camera/frames', headers=headers,
                               data={'scan_id': 'failed-db-scan-1', 'memory_enabled': 'true'},
                               files={'image': ('frame.jpg', jpeg(), 'image/jpeg')})
        assert response.status_code == 502
        if failure in [401, 403, 530]:
            assert 'CAMERA_SPACETIMEDB_TOKEN' in response.json()['detail']
        assert 'private-image-token' not in response.text
        assert 'image bytes' not in response.text
        assert client.get('/api/objects', headers=headers).json() == before


@pytest.mark.parametrize('url', ['http://remote.test', 'https://token:secret@image.test', 'https://image.test/path', 'wss://image.test'])
def test_image_sink_rejects_unsafe_origins(tmp_path, url):
    with pytest.raises(RuntimeError):
        Settings(data_dir=tmp_path, camera_frame_sink='spacetimedb', camera_spacetime_url=url,
                 camera_spacetime_database='images').validate()


def test_image_sink_requires_its_own_database_settings(tmp_path):
    with pytest.raises(RuntimeError, match='CAMERA_SPACETIMEDB_URL'):
        Settings(data_dir=tmp_path, camera_frame_sink='spacetimedb', spacetime_url='https://guests.test',
                 spacetime_database='guests', spacetime_token='guest-secret').validate()


def test_image_settings_load_independently_from_guest_settings(tmp_path, monkeypatch):
    for key, value in {
        'DATA_DIR': str(tmp_path), 'GUEST_PROFILE_STORE': 'local',
        'CAMERA_FRAME_SINK': 'spacetimedb', 'CAMERA_SPACETIMEDB_URL': 'https://images.test',
        'CAMERA_SPACETIMEDB_DATABASE': 'images-db', 'CAMERA_SPACETIMEDB_TOKEN': 'images-secret',
        'SPACETIMEDB_DATABASE': 'guests-db', 'SPACETIMEDB_SERVER_TOKEN': 'guest-secret',
        'VISION_PROVIDER': 'demo', 'ASSISTANT_PROVIDER': 'disabled', 'STORAGE_PROVIDER': 'local',
    }.items():
        monkeypatch.setenv(key, value)
    configured = Settings.from_env()
    configured.validate()
    assert configured.camera_spacetime_database == 'images-db'
    assert configured.spacetime_database == 'guests-db'
    assert configured.camera_spacetime_token == 'images-secret'
    assert configured.spacetime_token == 'guest-secret'
