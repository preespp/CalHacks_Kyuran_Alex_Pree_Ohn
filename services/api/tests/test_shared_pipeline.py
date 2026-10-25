"""Camera -> saved frame -> Onyu/Gemini -> shared memory -> second guest/Muse."""
import base64
from dataclasses import replace
import io
import json
import re
import time

from fastapi.testclient import TestClient
import httpx
from PIL import Image
import pytest

from commonplace_api.config import Settings
from commonplace_api.main import create_app
from commonplace_api.store import Store


class TeamDatabase:
    def __init__(self):
        self.frames = {}
        self.records = {}
        self.captures = {}
        self.history = []
        self.order = []
        self.vision_inputs = []
        self.commits = []
        self.fail_commit = False
        self.corrupt_readback = False
        self.fail_vision = False

    def handle(self, request):
        if request.url.host == 'generativelanguage.googleapis.com':
            assert request.headers['x-goog-api-key'] == 'vision-only-key'
            self.order.append('gemini')
            payload = json.loads(request.content)
            self.vision_inputs.append(base64.b64decode(payload['contents'][0]['parts'][1]['inlineData']['data']))
            if self.fail_vision:
                return httpx.Response(429)
            location = 'On the desk' if len(self.vision_inputs) == 1 else 'On the shelf'
            return httpx.Response(200, json={'candidates': [{'content': {'parts': [{'text': json.dumps({'objects': [
                {'label': 'Red cup', 'appearance': 'Red ceramic cup with a white star', 'location': location,
                 'box_2d': [100, 200, 600, 700]}]})}]}}]})
        if request.url.host == 'api.meta.ai':
            assert request.headers['Authorization'] == 'Bearer muse-only-key'
            payload = json.loads(request.content)
            if payload.get('tool_choice') == 'auto':
                return httpx.Response(200, json={'status': 'completed', 'output': [
                    {'type': 'function_call', 'call_id': 'lookup', 'name': 'search_household_memory', 'arguments': '{"q":"cup"}'}]})
            evidence = json.loads(payload['input'][-1]['output'])['matches'][0]['latest']
            assert evidence['source'] == 'gemini'
            return httpx.Response(200, json={'status': 'completed', 'output': [
                {'type': 'message', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': evidence['location']}]}]})
        assert request.url.host == 'team.test'
        assert 'muse-only-key' not in str(request.headers)
        if request.url.path.endswith('/call/upload_binary_frame'):
            p = json.loads(request.content)
            self.frames[p[0], p[1]] = p
            self.order.append('upload')
            return httpx.Response(200)
        if request.url.path.endswith('/call/commit_vision_capture'):
            self.order.append('commit')
            if self.fail_commit:
                return httpx.Response(500, text='private upstream body')
            household, session, sequence, timestamp, room, encoded = json.loads(request.content)
            records = json.loads(encoded)
            frame = self.frames[session, sequence]
            key = f'stream-{session}-{sequence}.jpg'
            self.captures[key] = (len(records), frame[-1])
            for record in records:
                self.records[record['object']['id']] = record
                self.history.append(record['object']['latest'])
            self.commits.append(json.loads(request.content))
            return httpx.Response(200)
        assert request.url.path.endswith('/sql')
        query = request.content.decode()
        if 'SELECT width, height, jpeg FROM image_stream_binary' in query:
            self.order.append('readback')
            session = re.search("session = '([^']+)'", query)[1]
            sequence = int(re.search(r'sequence = (\d+)', query)[1])
            p = self.frames[session, sequence]
            rows = [[p[3], p[4], '00' if self.corrupt_readback else p[5]]]
        elif 'FROM object_memory' in query:
            rows = [[json.dumps(record)] for record in self.records.values()]
        elif 'SELECT object_count' in query:
            key = re.search(r"\bid = '([^']+)'", query)[1]
            rows = [[self.captures[key][0]]] if key in self.captures else []
        elif 'SELECT jpeg' in query:
            key = re.search(r"\bid = '([^']+)'", query)[1]
            rows = [[self.captures[key][1]]] if key in self.captures else []
        elif 'FROM object_sighting' in query:
            rows = [[json.dumps(obs)] for obs in reversed(self.history)]
        else:
            rows = []
        return httpx.Response(200, json=[{'rows': rows}])


def setup(monkeypatch, tmp_path):
    db = TeamDatabase()
    sync, async_client = httpx.Client, httpx.AsyncClient
    transport = httpx.MockTransport(db.handle)
    monkeypatch.setattr(httpx, 'Client', lambda **kwargs: sync(transport=transport, **kwargs))
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: async_client(transport=transport, **kwargs))
    settings = Settings(data_dir=tmp_path, memory_provider='spacetimedb', guest_profile_store='local',
        camera_frame_sink='spacetimedb', camera_spacetime_url='https://team.test', camera_spacetime_database='team',
        vision_provider='gemini', gemini_model='vision-model', gemini_vision_api_key='vision-only-key',
        assistant_provider='muse', meta_api_key='muse-only-key', meta_model='muse-model')
    return db, settings


def upload(client, headers, scan):
    output = io.BytesIO()
    Image.new('RGB', (100, 80), 'red').save(output, 'JPEG')
    return client.post('/api/camera/frames', headers=headers, data={'scan_id': scan, 'memory_enabled': 'true'},
                       files={'image': ('frame.jpg', output.getvalue(), 'image/jpeg')})


def finish(client, headers, scan):
    for _ in range(200):
        result = client.get('/api/camera/streams/' + scan, headers=headers).json()
        if result['processed_frames'] or result['error']:
            return result
        time.sleep(.005)
    pytest.fail('Worker did not finish')


def test_camera_to_onyu_shared_memory_and_muse_survives_a_new_api_process(tmp_path, monkeypatch):
    db, settings = setup(monkeypatch, tmp_path)
    with TestClient(create_app(settings)) as client:
        scanner = {'Authorization': 'Bearer ' + client.post('/api/guest/session', json={'name': 'Scanner'}).json()['token']}
        reader = {'Authorization': 'Bearer ' + client.post('/api/guest/session', json={'name': 'Reader'}).json()['token']}
        assert client.get('/api/objects', headers=reader).json()['objects'] == []
        assert upload(client, scanner, 'shared-camera-run-1').status_code == 200
        assert finish(client, scanner, 'shared-camera-run-1')['count'] == 1
        first = client.get('/api/objects', headers=reader).json()['objects'][0]
        assert first['label'] == 'Red cup'
        assert first['latest']['spatial']['frame_position']['depth_value'] is None
        assert first['latest']['bbox'] == [.2, .1, .7, .6]
        assert db.order[:4] == ['upload', 'readback', 'gemini', 'commit']
        assert db.vision_inputs[0] == bytes.fromhex(next(iter(db.frames.values()))[-1])
        assert client.get(first['latest']['image_url'], headers=reader).status_code == 200
        assert upload(client, scanner, 'shared-camera-run-2').status_code == 200
        assert finish(client, scanner, 'shared-camera-run-2')['count'] == 1
        second = client.get('/api/objects', headers=reader).json()['objects']
        assert len(second) == 1 and second[0]['id'] == first['id']
        assert 'On the shelf' in second[0]['latest']['location']
        answer = client.post('/api/chat', headers=reader, json={'message': 'Where is the cup?'})
        assert answer.status_code == 200, answer.text
        assert 'shelf' in answer.json()['answer']
        assert 'seen_by' not in json.dumps(db.records) and 'Scanner' not in json.dumps(db.records)
        # The retained image remains readable after a queue consumer removes its source.
        db.frames.clear()
        assert client.get(first['latest']['image_url'], headers=reader).status_code == 200
        assert len(client.get('/api/objects/' + first['id'] + '/history', headers=reader).json()['observations']) == 2
    with TestClient(create_app(replace(settings, data_dir=tmp_path / 'another-api'))) as client:
        token = client.post('/api/guest/session', json={'name': 'Fresh process'}).json()['token']
        result = client.get('/api/objects', headers={'Authorization': 'Bearer ' + token}).json()['objects']
        assert len(result) == 1 and 'shelf' in result[0]['latest']['location']


@pytest.mark.parametrize('failure', ['corrupt_readback', 'fail_vision', 'fail_commit'])
def test_incomplete_pipeline_never_claims_memory_saved(tmp_path, monkeypatch, failure):
    db, settings = setup(monkeypatch, tmp_path)
    setattr(db, failure, True)
    with TestClient(create_app(settings)) as client:
        token = client.post('/api/guest/session', json={'name': 'Scanner'}).json()['token']
        headers = {'Authorization': 'Bearer ' + token}
        assert upload(client, headers, 'failed-camera-run').status_code == 200
        state = finish(client, headers, 'failed-camera-run')
        assert state['state'] == 'error' and state['processed_frames'] == 0
        assert client.get('/api/objects', headers=headers).json()['objects'] == []
        assert 'private upstream body' not in str(state)
        if failure == 'corrupt_readback':
            assert db.vision_inputs == []


def test_live_defaults_hide_old_sample_rows_without_deleting_them(tmp_path):
    old = Store(tmp_path / 'memory.sqlite3')
    old.seed()
    with TestClient(create_app(Settings(data_dir=tmp_path, guest_profile_store='local'))) as client:
        token = client.post('/api/guest/session', json={'name': 'Real user'}).json()['token']
        headers = {'Authorization': 'Bearer ' + token}
        assert client.get('/api/objects', headers=headers).json()['objects'] == []
        assert client.get('/api/activity', headers=headers).json()['events'] == []
        assert client.post('/api/demo/captures', headers=headers).status_code == 404
    assert len(old.objects('demo-home')) == 4
