.PHONY: help venv install install-dev init-db seed-reference backfill seed-demo ingest ingest-openmeteo ml dbt-build dbt-test test lint typecheck api scheduler status clean

PY ?= .venv/Scripts/python.exe

help:
	@echo "Targets:"
	@echo "  install        - pip install -r requirements.txt into .venv"
	@echo "  install-dev    - install dev tooling too"
	@echo "  init-db        - create schemas, hypertables, policies"
	@echo "  seed-reference - populate BA + US weather-station + EU zone-centroid reference tables (run once after init-db)"
	@echo "  seed-demo      - populate plausible recent data (source=DEMO)"
	@echo "  backfill       - hit all live sources for the last 168h"
	@echo "  dbt-build      - dbt deps + dbt build"
	@echo "  dbt-test       - dbt test"
	@echo "  ml             - run anomaly + forecast"
	@echo "  test           - pytest"
	@echo "  lint           - ruff"
	@echo "  typecheck      - mypy"
	@echo "  api            - launch FastAPI on :8787"
	@echo "  scheduler      - run long-lived ingestion scheduler"
	@echo "  status         - print freshness + table counts"

venv:
	python -m venv .venv

install: venv
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -r requirements.txt

install-dev: install
	$(PY) -m pip install -r requirements-dev.txt

init-db:
	$(PY) -m gridintel.cli init-db

seed-reference:
	$(PY) -m gridintel.cli seed-reference

backfill:
	$(PY) -m gridintel.cli backfill --hours 168

seed-demo:
	$(PY) -m gridintel.cli seed-demo --days 14

ingest:
	$(PY) -m gridintel.cli ingest all --hours 6

ingest-openmeteo:
	$(PY) -m gridintel.cli ingest openmeteo

ml:
	$(PY) -m gridintel.cli ml anomaly
	$(PY) -m gridintel.cli ml forecast

dbt-build:
	cd dbt && DBT_PROFILES_DIR=. ../.venv/Scripts/dbt deps
	cd dbt && DBT_PROFILES_DIR=. ../.venv/Scripts/dbt build

dbt-test:
	cd dbt && DBT_PROFILES_DIR=. ../.venv/Scripts/dbt test

test:
	$(PY) -m pytest tests -q

lint:
	$(PY) -m ruff check gridintel tests scripts

typecheck:
	$(PY) -m mypy gridintel --ignore-missing-imports

api:
	$(PY) -m gridintel.cli api

scheduler:
	$(PY) -m gridintel.cli scheduler

status:
	$(PY) -m gridintel.cli status

clean:
	rm -rf .pytest_cache .ruff_cache .mypy_cache dbt/target dbt/logs dbt/dbt_packages
