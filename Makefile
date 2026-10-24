.PHONY: setup api web muse-api muse-web connector check test
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

# Independent Muse UI test: no database, Gemini, or household login.
muse-api:
	.venv/bin/python -m uvicorn commonplace_api.assistant_lab:app --reload --host 127.0.0.1 --port 8002

muse-web:
	API_PROXY_TARGET=http://127.0.0.1:8000 MUSE_PROXY_TARGET=http://127.0.0.1:8002 npm run dev --workspace @commonplace/web -- --port 5173 --strictPort

connector:
	.venv/bin/python -m uvicorn commonplace_api.connector_gateway:app --host 127.0.0.1 --port 8001

check:
	npm run check
	$(MAKE) test

test:
	APP_ENV=development ASSISTANT_PROVIDER=disabled VISION_PROVIDER=demo STORAGE_PROVIDER=local .venv/bin/python -m pytest services/api/tests -q
