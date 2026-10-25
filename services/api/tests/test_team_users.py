import hashlib
import json
from contextlib import contextmanager

from fastapi.testclient import TestClient
import httpx
import pytest

from camera_capture.spacetime_wire import Writer
from commonplace_api.config import Settings
from commonplace_api.main import create_app


def configuration(tmp_path):
    return Settings(data_dir=tmp_path, guest_profile_store='spacetimedb',
                    spacetime_profile_table='user', spacetime_profile_access='public',
                    spacetime_url='https://team.example.test', spacetime_database='team-images',
                    spacetime_token='owner-token-must-not-be-used')


def test_existing_user_table_saves_distinct_guests_and_preserves_friends_on_restart(tmp_path, monkeypatch):
    rows = [[['0x' + 'c2' * 32], [0, 'Friend']], [['0x' + 'd3' * 32], [1, []]]]
    original_rows = json.loads(json.dumps(rows))
    next_identity = [0]
    identities = {}
    @contextmanager
    def connection(url, **kwargs):
        assert url == 'wss://team.example.test/v1/database/team-images/subscribe?compression=None'
        assert kwargs['subprotocols'] == ['v3.bsatn.spacetimedb']
        next_identity[0] += 1
        identity = f'{next_identity[0]:064x}'
        token = 'temporary-token-' + str(next_identity[0])
        identities[token] = identity
        row = [['0x' + identity], [1, []]]
        rows.append(row)  # Real module's on_connect inserts only this new identity.
        writer = Writer()
        writer.raw(b'\x00\x00' + bytes.fromhex(identity)[::-1] + bytes(16))
        writer.string(token)
        class Socket:
            def recv(self, timeout):
                return writer.finish()
        yield Socket()
    monkeypatch.setattr('commonplace_api.guest_profiles.connect', connection)
    original = httpx.Client
    def server(request):
        assert request.url.host == 'team.example.test'
        assert 'owner-token-must-not-be-used' not in str(request.headers)
        if request.method == 'GET':
            return httpx.Response(200, json={})
        if request.url.path.endswith('/sql'):
            assert 'Authorization' not in request.headers
            assert request.content == b'SELECT identity, name FROM user'
            return httpx.Response(200, json=[{'rows': rows}])
        assert request.url.path.endswith('/call/set_name')
        identity = identities[request.headers['Authorization'].removeprefix('Bearer ')]
        row = next(row for row in rows if row[0] == ['0x' + identity])
        row[1] = [0, json.loads(request.content)[0]]
        return httpx.Response(200)
    monkeypatch.setattr('commonplace_api.guest_profiles.httpx.Client',
                        lambda **kwargs: original(transport=httpx.MockTransport(server), **kwargs))
    settings = configuration(tmp_path)
    with TestClient(create_app(settings)) as client:
        preexisting = client.get('/api/guest/users').json()['users']
        assert [row['name'] for row in preexisting] == ['Friend']
        pree = client.post('/api/guest/session', json={'name': 'Pree'}).json()['member']
        alex = client.post('/api/guest/session', json={'name': 'Alex'}).json()['member']
        assert pree['id'] != alex['id']
        assert pree['id'] == 'guest-' + hashlib.sha256(bytes.fromhex(f'{1:064x}')).hexdigest()[:32]
    with TestClient(create_app(settings)) as client:
        saved = client.get('/api/guest/users').json()['users']
        assert {row['name'] for row in saved} == {'Friend', 'Pree', 'Alex'}
        assert client.post('/api/guest/session', json={'user_id': pree['id']}).json()['member'] == pree
    assert rows[:2] == original_rows
    assert next_identity[0] == 2  # Selecting an existing guest never creates or renames a row.


def test_user_table_connection_errors_do_not_leak_tokens_or_fall_back(tmp_path, monkeypatch):
    original = httpx.Client
    def respond(request):
        return httpx.Response(200, json={} if request.method == 'GET' else [{'rows': []}])
    monkeypatch.setattr('commonplace_api.guest_profiles.httpx.Client', lambda **kwargs: original(
        transport=httpx.MockTransport(respond), **kwargs))
    def failure(*args, **kwargs):
        raise OSError('private temporary token')
    monkeypatch.setattr('commonplace_api.guest_profiles.connect', failure)
    with TestClient(create_app(configuration(tmp_path))) as client:
        response = client.post('/api/guest/session', json={'name': 'No phantom user'})
        assert response.status_code == 503
        assert 'private temporary token' not in response.text
        assert client.get('/api/guest/users').json()['users'] == []


def test_user_adapter_requires_public_access_and_known_table(tmp_path):
    with pytest.raises(RuntimeError, match='PROFILE_ACCESS'):
        Settings(data_dir=tmp_path, spacetime_profile_table='user').validate()
    with pytest.raises(RuntimeError, match='PROFILE_TABLE'):
        Settings(data_dir=tmp_path, spacetime_profile_table='wrong').validate()
