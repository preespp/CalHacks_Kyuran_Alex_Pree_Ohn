import asyncio
import io
import time

from fastapi.testclient import TestClient
from PIL import Image

from commonplace_api.camera_jobs import CameraJobs
from commonplace_api.config import Settings
from commonplace_api.main import create_app
from commonplace_api.models import Detection
from commonplace_api.vision import VisionError


def test_backend_worker_coalesces_latest_frame_and_bounds_inference():
    async def scenario():
        entered = asyncio.Event()
        release = asyncio.Event()
        seen = []
        active = 0
        peak = 0
        async def process(home, scan, image, room, observed_at):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            seen.append(image)
            if len(seen) == 1:
                entered.set()
                await release.wait()
            active -= 1
            return {"count": 1}
        jobs = CameraJobs(process)
        jobs.offer('home', 'scan', b'first', 'Office', 'time-1', 0)
        await entered.wait()
        jobs.offer('home', 'scan', b'middle', 'Office', 'time-2', 0)
        jobs.offer('home', 'scan', b'latest', 'Office', 'time-3', 0)
        assert jobs.status('other-home', 'scan')['state'] == 'disabled'
        release.set()
        for _ in range(20):
            await asyncio.sleep(0)
            if jobs.status('home', 'scan')['processed_frames'] == 2:
                break
        assert seen == [b'first', b'latest']
        assert peak == 1
        assert jobs.status('home', 'scan')['observed_at'] == 'time-3'
        await jobs.close()
    asyncio.run(scenario())


def test_quota_failure_does_not_retry_until_new_scan_and_stop_cancels_work():
    async def scenario():
        calls = []
        async def process(*args):
            calls.append(args)
            raise VisionError('Gemini quota was reached')
        jobs = CameraJobs(process, max_streams=1)
        jobs.offer('home', 'scan', b'image', 'Office', 'time', 0)
        for _ in range(5):
            await asyncio.sleep(0)
        assert jobs.status('home', 'scan')['state'] == 'error'
        jobs.offer('home', 'scan', b'another', 'Office', 'time', 0)
        await asyncio.sleep(0)
        assert len(calls) == 1
        jobs.offer('home', 'new-scan', b'image', 'Office', 'time', 0)
        assert len(jobs.streams) == 1
        jobs.stop('home', 'new-scan')
        assert jobs.status('home', 'new-scan')['state'] == 'disabled'
        await jobs.close()
    asyncio.run(scenario())


def test_frame_ingestion_returns_before_backend_analysis_and_commits_shared_memory(tmp_path, monkeypatch):
    calls = []
    async def detect(settings, image, room):
        calls.append(room)
        await asyncio.sleep(.05)
        return [Detection(label='Cup', appearance='A red cup with a star', location='On the desk', bbox=[.1, .2, .5, .6])]
    monkeypatch.setattr('commonplace_api.main.detect', detect)
    settings = Settings(data_dir=tmp_path, vision_provider='gemini', gemini_vision_api_key='mock', gemini_model='mock')
    image = io.BytesIO()
    Image.new('RGB', (100, 80), 'red').save(image, format='JPEG')
    with TestClient(create_app(settings)) as client:
        scanner = client.post('/api/guest/session', json={'name': 'Scanner'}).json()['token']
        reader = client.post('/api/guest/session', json={'name': 'Reader'}).json()['token']
        headers = {'Authorization': f'Bearer {scanner}'}
        response = client.post('/api/camera/frames', headers=headers,
                               data={'scan_id': 'stream-test-1', 'memory_enabled': 'true', 'room': 'Office'},
                               files={'image': ('frame.jpg', image.getvalue(), 'image/jpeg')})
        assert response.status_code == 200
        assert response.json()['analysis']['processed_frames'] == 0
        for _ in range(100):
            state = client.get('/api/camera/streams/stream-test-1', headers=headers).json()
            if state['processed_frames']:
                break
            time.sleep(.005)
        assert state['processed_frames'] == 1
        objects = client.get('/api/objects?q=cup', headers={'Authorization': f'Bearer {reader}'}).json()['objects']
        assert len(objects) == 1
        assert objects[0]['latest']['location'] == 'On the desk'
        assert objects[0]['latest']['source'] == 'gemini'
        assert 'actor_id' not in objects[0]['latest']
        assert client.delete('/api/camera/streams/stream-test-1', headers=headers).status_code == 204
        assert client.get('/api/camera/streams/stream-test-1', headers=headers).json()['state'] == 'disabled'
        assert calls == ['Office']
