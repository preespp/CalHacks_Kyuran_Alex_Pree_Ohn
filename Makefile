.PHONY: setup api web check test
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

check:
	npm run check
	.venv/bin/python -m pytest services/api/tests -q

test:
	.venv/bin/python -m pytest services/api/tests -q
