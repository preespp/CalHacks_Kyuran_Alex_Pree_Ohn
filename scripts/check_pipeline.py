"""Read-only live-workflow checks. Never generates images/text or changes a database."""
import sys

import httpx

from commonplace_api.config import Settings


def main():
    settings = Settings.from_env()
    try:
        settings.validate()
    except RuntimeError as error:
        print('Configuration:', str(error))
        return 1
    print('Vision:', settings.vision_provider)
    print('Object memory:', settings.memory_provider)
    print('Image delivery:', settings.camera_frame_sink)
    print('Sample records:', 'enabled' if settings.seed_sample_data else 'hidden')
    print('Vision enrichment:', settings.vision_enrichment)
    if not settings.camera_spacetime_database or not settings.camera_spacetime_url:
        print('Set CAMERA_SPACETIMEDB_URL and CAMERA_SPACETIMEDB_DATABASE for the live workflow.')
        return 1
    url = settings.camera_spacetime_url.rstrip('/') + '/v1/database/' + settings.camera_spacetime_database
    try:
        response = httpx.get(url + '/schema?version=9', timeout=15, follow_redirects=False)
        response.raise_for_status()
        schema = response.json()
        missing = {'image_stream_binary', 'vision_capture', 'object_memory', 'object_sighting'} - {row['name'] for row in schema['tables']}
        reducers = {row['name'] for row in schema['reducers']}
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        print('Cannot read the configured image/memory database schema.')
        return 1
    if missing:
        print('Missing hosted tables:', ', '.join(sorted(missing)))
    if 'commit_vision_capture' not in reducers:
        print('Missing hosted reducer: commit_vision_capture')
    configured = settings.vision_provider == 'gemini' and settings.memory_provider == 'spacetimedb' and settings.camera_frame_sink == 'spacetimedb'
    if not configured:
        print('For live object updates, enable VISION_PROVIDER=gemini, MEMORY_PROVIDER=spacetimedb, CAMERA_FRAME_SINK=spacetimedb.')
    ready = not missing and 'commit_vision_capture' in reducers and configured
    print('Live workflow configuration:', 'ready for a camera test' if ready else 'incomplete')
    print('No model requests or database writes were made.')
    return 0 if ready else 1


if __name__ == '__main__':
    sys.exit(main())
