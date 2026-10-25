"""Owner-authenticated JPEG queue; only database readbacks enter the SLAM spool."""
import base64
import json
import os
import http.client
import threading
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DATABASE = os.getenv('SPACETIMEDB_DATABASE', 'c2005dfa977b978871c77ab400a529efd494fce3e8d3d60c2aa786050f6ebd02')
HOST = os.getenv('SPACETIMEDB_HOST', 'https://maincloud.spacetimedb.com')
SPOOL = ROOT / '.data' / 'streams'
_connections = threading.local()


def request(route, payload):
    token = os.getenv('SPACETIMEDB_TOKEN') or (ROOT / '.data' / 'db-token').read_text().strip()
    # Reuse TLS connections across frames; each worker thread owns its connection.
    if not getattr(_connections, 'connection', None):
        host = urlsplit(HOST)
        connection_type = http.client.HTTPSConnection if host.scheme == 'https' else http.client.HTTPConnection
        _connections.connection = connection_type(host.hostname, host.port, timeout=25)
    connection = _connections.connection
    try:
        connection.request('POST', f'/v1/database/{DATABASE}/{route}', body=payload.encode(),
            headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
        response = connection.getresponse()
        body = response.read()
        if response.status >= 400:
            raise RuntimeError(f'SpacetimeDB {route}: HTTP {response.status}: {body.decode(errors="replace")[:300]}')
        return json.loads(body) if body else None
    except Exception:
        connection.close()
        _connections.connection = None
        # Do not retry a mutation: the server may already have committed it.
        raise


def transfer(session, sequence, captured_us, jpeg, width, height):
    request('call/upload_image_frame', json.dumps([session, sequence, captured_us, width, height, base64.b64encode(jpeg).decode()]))
    # One in-flight frame per session: acknowledge only after durable local readback.
    results = request('sql', f"SELECT * FROM image_stream WHERE session = '{session}' AND sequence = {sequence}")
    rows = results[0]['rows']
    if len(rows) != 1:
        raise RuntimeError('Expected exactly one stored frame')
    row_id, stored_session, seq, stamp, w, h, encoded = rows[0]
    restored = base64.b64decode(encoded, validate=True)
    if restored != jpeg:
        raise RuntimeError('Database JPEG readback mismatch')
    directory = SPOOL / stored_session
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f'{int(seq):08d}.jpg'
    temporary = target.with_suffix('.tmp')
    temporary.write_bytes(restored)
    temporary.replace(target)
    with (directory / 'frames.jsonl').open('a') as output:
        output.write(json.dumps({'file': target.name, 'timestamp': int(stamp) / 1e6}) + '\n')
    request('call/acknowledge_image_frame', json.dumps([row_id]))
    return str(target)
