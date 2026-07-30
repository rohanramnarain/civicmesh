SHELL := /bin/zsh

.PHONY: up down logs api web worker lint fmt

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

api:
	cd apps/api && uv run uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

web:
	cd apps/web && npm run dev

worker:
	cd apps/worker-sim && uv run python -m src.supervisor

migrate:
	./scripts/apply_migrations.sh

build-embeddings:
	cd apps/api && uv run python ../../scripts/build_embeddings.py --max-datasets 60

featured-data:
	cd apps/api && uv run python ../../scripts/aggregate_311_csv.py

generate-10k-jobs:
	curl -sS -X POST "http://localhost:8000/jobs/generated/build?target_count=10000" | cat

generated-jobs:
	curl -sS "http://localhost:8000/jobs/generated?offset=0&limit=20" | cat

runs-mine:
	curl -sS "http://localhost:8000/runs/mine?limit=10" -H "Authorization: Bearer local-dev-user" | cat

mobile-flutter:
	cd apps/mobile_flutter && flutter pub get && flutter run

jobs-list:
	curl -sS http://localhost:8000/jobs | cat

job-run:
	curl -sS -X POST "http://localhost:8000/jobs/heat-vulnerability-zones/run?limit=10" | cat

lint:
	cd apps/api && uv run ruff check .

fmt:
	cd apps/api && uv run ruff format .
