"""Persistent SpacetimeDB subscription with bounded, ordered frame delivery."""
import asyncio
import json
import os
import re
import urllib.parse
import urllib.request

import websockets

from spacetime_stream import ROOT, HOST, DATABASE, SPOOL
from spacetime_wire import Reader, Writer, encode_subscribe, parse_server_message

TABLE = 'image_stream_binary'


def websocket_token():
    token = os.getenv('SPACETIMEDB_TOKEN') or (ROOT / '.data/db-token').read_text().strip()
    req = urllib.request.Request(HOST + '/v1/identity/websocket-token', data=b'',
                                 headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)['token']


def decode_rows(blob):
    reader = Reader(blob)
    while reader.remaining():
        yield (reader.u64(), reader.string(), reader.u32(), reader.u64(),
               reader.u32(), reader.u32(), reader.byte_array())


def save_row(row):
    _, session, sequence, stamp, _, _, jpeg = row
    directory = SPOOL / session
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f'{sequence:08d}.jpg'
    temporary = target.with_suffix('.tmp')
    temporary.write_bytes(jpeg)
    temporary.replace(target)
    with (directory / 'frames.jsonl').open('a') as output:
        output.write(json.dumps({'file': target.name, 'timestamp': stamp / 1e6}) + '\n')
    return str(target)


class BinaryStream:
    def __init__(self, session):
        if not re.fullmatch('[a-f0-9]{32}', session):
            raise ValueError('Invalid stream session')
        self.session = session
        self.calls = {}
        self.rows = {}
        self.request_id = 1
        self.next_sequence = 1
        self.order = asyncio.Condition()
        self.failed = None

    async def __aenter__(self):
        token = await asyncio.to_thread(websocket_token)
        url = HOST.replace('https://', 'wss://').replace('http://', 'ws://')
        url += f'/v1/database/{DATABASE}/subscribe?' + urllib.parse.urlencode({'compression': 'None', 'token': token})
        self.ws = await websockets.connect(url, subprotocols=['v3.bsatn.spacetimedb'],
                                           max_size=16 * 1024 * 1024, open_timeout=20)
        self.ready = asyncio.get_running_loop().create_future()
        self.listener = asyncio.create_task(self.listen())
        try:
            await asyncio.wait_for(asyncio.shield(self.ready), 25)
        except BaseException:
            await self.__aexit__(None, None, None)
            raise
        return self

    async def __aexit__(self, *args):
        await self.ws.close()
        self.listener.cancel()
        await asyncio.gather(self.listener, return_exceptions=True)
        for future in [*self.calls.values(), *self.rows.values()]:
            if not future.done():
                future.cancel()

    async def call(self, name, args):
        if self.failed:
            raise self.failed
        self.request_id += 1
        request_id = self.request_id
        result = asyncio.get_running_loop().create_future()
        self.calls[request_id] = result
        writer = Writer()
        writer.u8(3)
        writer.u32(request_id)
        writer.u8(0)
        writer.string(name)
        writer.byte_array(args)
        try:
            await self.ws.send(writer.finish())
            await asyncio.wait_for(result, 25)
        finally:
            self.calls.pop(request_id, None)

    async def listen(self):
        try:
            async for message in self.ws:
                for event in parse_server_message(message):
                    kind = event['type']
                    if kind == 'connected':
                        await self.ws.send(encode_subscribe(1, 1,
                            f"SELECT * FROM {TABLE} WHERE session = '{self.session}'"))
                    elif kind == 'snapshot':
                        if not self.ready.done():
                            self.ready.set_result(None)
                    elif kind in ('error', 'reducer_err'):
                        raise RuntimeError(event['message'])
                    if kind == 'update':
                        for table, operation, blob in event['ops']:
                            if table != TABLE or operation != 'insert':
                                continue
                            for row in decode_rows(blob):
                                future = self.rows.get(row[2])
                                if row[1] == self.session and future and not future.done():
                                    future.set_result(row)
                    if kind in ('update', 'reducer_ok') and 'request_id' in event:
                        future = self.calls.get(event['request_id'])
                        if future and not future.done():
                            future.set_result(None)
            raise ConnectionError('Database subscription closed')
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.failed = error
            for future in [self.ready, *self.calls.values(), *self.rows.values()]:
                if not future.done():
                    future.set_exception(error)

    async def transfer(self, sequence, captured_us, jpeg, width, height):
        future = asyncio.get_running_loop().create_future()
        self.rows[sequence] = future
        writer = Writer()
        writer.string(self.session)
        writer.u32(sequence)
        writer.raw(captured_us.to_bytes(8, 'little'))
        writer.u32(width)
        writer.u32(height)
        writer.byte_array(jpeg)
        try:
            await self.call('upload_binary_frame', writer.finish())
            row = await asyncio.wait_for(future, 25)
            if row[3:] != (captured_us, width, height, jpeg):
                raise RuntimeError('Database frame readback mismatch')
            # Concurrent uploads may finish out of order; the SLAM manifest must not.
            async with self.order:
                await asyncio.wait_for(self.order.wait_for(lambda: sequence == self.next_sequence), 25)
                target = await asyncio.to_thread(save_row, row)
                self.next_sequence += 1
                self.order.notify_all()
            await self.call('acknowledge_binary_frame', row[0].to_bytes(8, 'little'))
            return target
        finally:
            self.rows.pop(sequence, None)
            if not future.done():
                future.cancel()
            elif not future.cancelled():
                future.exception()  # Retrieve errors if the reducer failed first.
