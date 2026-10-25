"""Shared live memory in the team's SpacetimeDB, separate from local sessions.

The worker reads the exact uploaded frame, then commits current objects, history,
and retained image evidence in one reducer transaction. No queue rows are deleted.
"""
import hashlib
import json

import httpx
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from .models import ObjectResponse, ObservationResponse
from .vision import VisionError
from .frame_sink import FrameUploadError


class ObjectMemoryError(VisionError):
    pass


def quoted(value):
    return "'" + value.replace("'", "''") + "'"


class SpacetimeMemory:
    provider = "spacetimedb"

    def __init__(self, settings):
        self.url = settings.camera_spacetime_url.rstrip('/') + '/v1/database/' + settings.camera_spacetime_database
        self.token = settings.camera_spacetime_token

    def request(self, path, **kwargs):
        headers = {"Content-Type": "application/json" if "json" in kwargs else "text/plain"}
        if self.token:
            headers['Authorization'] = 'Bearer ' + self.token
        try:
            with httpx.Client(timeout=20, follow_redirects=False) as client:
                response = client.post(self.url + path, headers=headers, **kwargs)
            response.raise_for_status()
            return response
        except httpx.HTTPError:
            raise ObjectMemoryError("Shared object memory is unavailable. Check that the vision_capture, object_memory and object_sighting tables and commit_vision_capture reducer are published.") from None

    def sql(self, query):
        try:
            return self.request('/sql', content=query).json()[0]['rows']
        except (ValueError, KeyError, TypeError, IndexError):
            raise ObjectMemoryError("Shared object memory returned an incompatible response.") from None

    def check_ready(self):
        for table in ('vision_capture', 'object_memory', 'object_sighting'):
            self.sql(f'SELECT id FROM {table} LIMIT 0')

    def records(self, household):
        try:
            records = [json.loads(row[0]) for row in self.sql(
                f'SELECT record_json FROM object_memory WHERE household_id = {quoted(household)}')]
            for record in records:
                record['object'] = ObjectResponse.model_validate(record['object']).model_dump()
            return records
        except (ValueError, KeyError, TypeError, ValidationError):
            raise ObjectMemoryError("A shared observation could not be read. Your existing memories have not been changed.") from None

    def objects(self, household, query='', room=''):
        terms = [word.strip('?!.,') for word in query.casefold().split()
                 if word not in {'where', 'is', 'are', 'my', 'the', 'our', 'a', 'an', 'did', 'we', 'leave', 'it', 'for'}]
        objects = []
        for record in self.records(household):
            obj = record['object']
            haystack = ' '.join([obj['label'], obj['appearance'], *obj['aliases'],
                                 obj['latest']['room'], obj['latest']['location']]).casefold()
            if (not room or obj['latest']['room'] == room) and all(term in haystack for term in terms):
                objects.append(obj)
        return sorted(objects, key=lambda obj: obj['latest']['observed_at'], reverse=True)

    def history(self, household, object_id):
        try:
            rows = [ObservationResponse.model_validate_json(row[0]).model_dump() for row in self.sql(
                f'SELECT observation_json FROM object_sighting WHERE household_id = {quoted(household)} AND object_id = {quoted(object_id)}')]
            return sorted(rows, key=lambda row: row['observed_at'], reverse=True)
        except (ValueError, ValidationError):
            raise ObjectMemoryError("The object's history could not be read.") from None

    def activity(self, household):
        try:
            rows = [ObservationResponse.model_validate_json(row[0]).model_dump() for row in self.sql(
                f'SELECT observation_json FROM object_sighting WHERE household_id = {quoted(household)}')]
            return sorted(rows, key=lambda row: row['observed_at'], reverse=True)[:30]
        except (ValueError, ValidationError):
            raise ObjectMemoryError("The household timeline could not be read.") from None

    def get_image(self, household, key):
        rows = self.sql(f'SELECT jpeg FROM vision_capture WHERE household_id = {quoted(household)} AND id = {quoted(key)}')
        if not rows:
            raise FileNotFoundError
        try:
            return bytes.fromhex(rows[0][0])
        except (ValueError, TypeError):
            raise ObjectMemoryError("The saved image could not be read.") from None

    async def analyze(self, settings, sink, household, scan_id, reference, room, captured_at):
        from services.worker.pipeline import CaptureInput, process_capture
        from services.worker.matching import TrackedObject

        receipt = reference['receipt']
        key = f"stream-{receipt['session']}-{receipt['sequence']}.jpg"
        cached = await run_in_threadpool(self.sql,
            f'SELECT object_count FROM vision_capture WHERE household_id = {quoted(household)} AND id = {quoted(key)}')
        if cached:
            return {'count': cached[0][0]}
        try:
            jpeg = await sink.read(reference)
        except FrameUploadError as error:
            raise ObjectMemoryError(str(error)) from None
        prior = await run_in_threadpool(self.records, household)
        tracked = []
        for record in prior:
            obj = record['object']
            if obj['latest']['room'] == room:
                tracked.append(TrackedObject(object_id=obj['id'], label=obj['label'], appearance=obj['appearance'],
                    embedding=record.get('embedding', []), aliases=obj['aliases'], updated_at=obj['latest']['observed_at']))
        try:
            results = await process_capture(settings, CaptureInput(raw_bytes=jpeg, room=room,
                capture_id=key, photo_url='/api/images/' + key, household_id=household,
                timestamp=captured_at, normalized=True), existing_objects=tracked)
        except ImportError:
            raise ObjectMemoryError("Optional depth/visual-matching models are not installed. Install the API spatial extra or use VISION_ENRICHMENT=geometry.") from None
        records = []
        for result in results:
            sighting = result['sightings'][-1]
            obs = ObservationResponse(id=hashlib.sha256((key + result['object_id']).encode()).hexdigest()[:32],
                object_id=result['object_id'], room=room, location=result['current']['summary'][:300],
                image_url='/api/images/' + key, bbox=sighting['frame_position']['bbox_norm'],
                source='gemini', kind='seen', observed_at=captured_at, label=result['label'],
                spatial={'frame_position': sighting['frame_position'], 'relations': sighting['relations']})
            obj = ObjectResponse(id=result['object_id'], label=result['label'], appearance=result['appearance'],
                                 aliases=result['aliases'], latest=obs, last_visual=obs)
            records.append({'object': obj.model_dump(), 'embedding': result.get('embedding', [])})
        await run_in_threadpool(self.request, '/call/commit_vision_capture',
            json=[household, receipt['session'], receipt['sequence'], captured_at, room,
                  json.dumps(records, separators=(',', ':'), allow_nan=False)])
        return {'count': len(records), 'source': 'gemini', 'object_ids': [r['object']['id'] for r in records]}
