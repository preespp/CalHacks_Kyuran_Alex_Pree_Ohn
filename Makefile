.PHONY: setup api web connector check test
PYTHON ?= python3.12

setup:
	npm ci
	$(PYTHON) -m venv .venv
	.venv/bin/python -m pip install -r services/api/requirements-dev.lock
	.venv/bin/python -m pip install --no-deps -e services/api

api:
	.venv/bin/python -m uvicorn commonplace_api.main:app --reload --host 127.0.0.1 --port 8000

web:
	npm run dev

connector:
	.venv/bin/python -m uvicorn commonplace_api.connector_gateway:app --host 127.0.0.1 --port 8001

check:
	npm run check
	$(MAKE) test

test:
	MEMORY_PROVIDER=sqlite SEED_SAMPLE_DATA=false APP_ENV=development GUEST_PROFILE_STORE=local CAMERA_FRAME_SINK=disabled ASSISTANT_PROVIDER=disabled VISION_PROVIDER=demo STORAGE_PROVIDER=local .venv/bin/python -m pytest services/api/tests -q
