# CivicGrid NYC

CivicGrid NYC is a local-first civic forecasting platform focused on NYC 311 Open Data.

The simplified core idea is:

- Embed 2025 NYC 311 complaint signals by complaint type and ZIP code.
- Train three forecast model variants (Random Forest, XGBoost, LightGBM).
- Predict 2026 complaint totals for each complaint type in each ZIP code.
- Compare model quality side-by-side and keep predictions reproducible.

This repository is the implementation workspace for that final product.

## Live App

The latest CivicGrid NYC web frontend is deployed at:

**https://civicgrid-e8b69.web.app**

It loads the active 311 forecast release (`20260729-022708`) from Firestore and runs
model inference locally in the browser. No backend forecast API is used.

## 311 Forecast Setup & Deployment

### Live deployment

- **Firebase URL:** https://civicgrid-e8b69.web.app
- **Firebase project ID:** `civicgrid-e8b69`
- **Firestore database ID:** `nycdata`
- **Active forecast release:** `20260729-022708`
- **Last verified:** 2026-07-31
- **Deployment status:** Deployed and passing CI

The hosted frontend loads versioned 311 embedding records from Firestore and runs
Random Forest, XGBoost, and LightGBM inference locally in the browser using ONNX
Runtime Web. No backend forecast API is used at runtime.

### Local development commands

From the repository root:

```bash
git checkout main
git pull origin main
cd apps/web
npm install
npm test
npm run build
npm run dev -- --host 127.0.0.1 --port 5173
```

Open http://127.0.0.1:5173/ (or the port Vite reports if 5173 is in use).

### Frontend environment variables

Copy the example file and fill in values from the Firebase web-app configuration
for project `civicgrid-e8b69`:

```bash
cp apps/web/.env.example apps/web/.env
```

Required variables in `apps/web/.env` (values omitted for security):

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

`VITE_FIREBASE_PROJECT_ID` must be `civicgrid-e8b69`. Never commit this file or
paste credentials into README.md.

### Firestore paths used by the forecast flow

- Release manifest: `forecast_releases/{release_id}/metadata/manifest`
- Embedding records: `forecast_releases/{release_id}/embedding_records/{record_id}`
- Active release in the frontend: `20260729-022708` (defined in
  `apps/web/src/forecast/releaseManifest.ts`)

### Real Firestore mode vs local mock mode

- **Real mode:** When valid Firebase config is present, the app fetches the
  embedding record for the selected ZIP + complaint type from the `nycdata`
  Firestore database, validates its checksum, and runs ONNX inference.
- **Mock mode:** Without Firebase config or if the Firestore read fails, the app
  falls back to a small bundled mock embedding record. The featured dataset also
  uses mock data when the local API is not running.

### Deploy to Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
firebase use civicgrid-e8b69
./scripts/deploy_firebase.sh
```

This builds `apps/web/dist` and deploys it to Firebase Hosting. After deploying,
open the generated URL and test the forecast flow.

Deploy Firestore rules/indexes/storage only when those files have changed and
been reviewed:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

### Known limitations / blockers

- The forecast ZIP-code dropdown is currently limited to `10025` and `10027` for
  demo purposes, even though the Firestore release contains records for many more
  ZIP codes.
- LightGBM may predict `0.00` for some ZIP + complaint-type combinations (e.g.
  `10027` + `heat/hot water`) while returning non-zero values for others. This
  appears to be a model-specific behavior rather than a data-loading error.
- The featured dataset at the top of the page falls back to mock data when the
  local API is not running; this is separate from the 311 forecast flow.

## Simplified Product Goal

The product now centers on one local-first forecasting workflow:

1. Precompute 311 embeddings and forecast features offline for every ZIP + complaint-type + year key.
2. Ship versioned, immutable ONNX model artifacts (Random Forest, XGBoost, LightGBM) to the frontend.
3. Run next-year inference locally in the browser from a Firestore embedding record and the selected model.
4. Display the prediction, model comparison metrics, and full provenance without calling a backend forecast API.

## Delivery Order (Explicit)

Implementation sequence is fixed:

1. Web app first (Vite/React).
2. Flutter + ONNX + Swift bridge second, after web parity is complete.

### Phase 1: Web App First

1. Build offline pipeline to normalize NYC 311 data and precompute embeddings.
2. Publish compact, versioned embedding records to Firestore.
3. Train Random Forest, XGBoost, and LightGBM candidates offline and export to ONNX.
4. Run model inference locally in the browser via ONNX Runtime Web.
5. Display prediction, model comparison metrics, and reproducibility provenance.

### Phase 2: Flutter + ONNX + Swift Bridge Later

1. Freeze web model interface contract (request/response schema and feature rules).
2. Reuse trained ONNX model artifacts and validate parity against web outputs.
3. Build Swift bridge for ONNX Runtime and expose typed APIs to Flutter.
4. Implement Flutter screens matching web behavior and metrics.
5. Run parity suite to confirm Flutter predictions stay within acceptable tolerance from web baseline.

## Manual Human Tasks (Required)

The following steps cannot be fully automated and must be done by humans:

1. Select and approve the exact NYC 311 complaint taxonomy and ZIP normalization rules for 2025.
2. Verify and clean raw data edge cases (missing ZIPs, invalid ZIP formats, merged complaint labels).
3. Decide acceptance thresholds for model quality (minimum MAE/RMSE targets).
4. Review model outputs for civic reasonableness before publishing any forecast externally.
5. Approve which model variant becomes default after comparison (or keep all three visible).
6. Perform legal/policy review on public-facing forecast messaging and caveat language.
7. Run release sign-off after manual QA on key ZIP + complaint slices.

## Non-Negotiable Constraints

- No opaque server-side answer generation for user jobs.
- No arbitrary code execution on user devices.
- Every public result includes provenance, caveats, and version metadata.
- NYC Open Data is the MVP data source.

## What Exists Today

Current implementation status in this repo:

- Monorepo with API, web app, worker simulator, mobile app, and DB migrations.
- Local infrastructure via Docker Compose (Postgres/PostGIS, Redis, Qdrant).
- FastAPI service with ingestion, embedding build, and publish validation endpoints.
- Web app (Vite + React + TypeScript) with local ONNX inference, IndexedDB embedding cache, and provenance display, deployed to Firebase Hosting.
- Precomputed 311 embedding records, versioned release manifest, and ONNX model artifacts for Random Forest, XGBoost, and LightGBM.
- Deterministic job recipes plus generated job catalog (10,000+ target).
- Firebase Hosting/Auth scaffolding and deployment scripts.

## Embedding Strategy

- 311 corpus embeddings are generated offline in a controlled release pipeline, quantized to int8, and stored in Firestore under versioned releases.
- The browser fetches only the embedding record required for the selected ZIP + complaint type.
- Fetched records are cached in IndexedDB and validated against the active release manifest (dataset, embedding, and feature-schema versions).
- User query embeddings for the experimental dataset-search tool still run locally in the browser; they are not used by the 311 forecast flow.
- Model artifacts (ONNX) are shipped with the web app and cached locally.

## Architecture Overview

- Web client
	Local inference runtime and local persistence (IndexedDB).
- API
	Dataset ingestion, deterministic job helpers, artifact manifest generation, publish validation.
- Postgres
	Dataset metadata, generated jobs, published runs, and supporting artifacts.
- Firebase
	Static hosting, auth, and artifact/config distribution.

## Repository Layout

- apps/api: FastAPI backend
- apps/web: React web frontend
- apps/mobile_flutter: Flutter mobile client
- apps/worker-sim: local worker/supervisor simulator
- db/migrations: SQL migrations
- scripts: helper scripts for bootstrap, deploy, embeddings, and migrations

## Run Modes

### Frontend-Only (fastest way to see the product)

Use this when you only want to see the interface shell.

```bash
cd apps/web
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open: http://127.0.0.1:5173/

Notes:

- The UI renders without Firebase credentials.
- The 311 forecast flow works in this mode using local mock embedding and dataset artifacts.
- API-backed actions (ingest/search/publish) and real Firestore embedding reads require backend services or Firebase config.

### Full Local Stack

Prerequisites:

- Docker Desktop
- Python 3.11+
- uv
- Node.js 20+

Bootstrapping:

```bash
cp .env.example .env
docker compose up -d
cd apps/api && uv sync
cd ../web && npm install
cd ../..
make migrate
```

Run in separate terminals:

```bash
make api
make web
```

Endpoints:

- API docs: http://localhost:8000/docs
- Web app: http://localhost:5173

## Current API Surface

- POST /ingest/catalog
- GET /datasets/search
- GET /jobs
- POST /jobs/{job_id}/run
- POST /jobs/generated/build
- GET /jobs/generated
- GET /jobs/generated/{job_id}
- POST /embeddings/build
- POST /runs/publish
- GET /runs/mine

Removed from the analysis path:

- ~~POST /forecast311/train-and-predict~~ — 311 forecast inference now runs locally in the browser.

Current curated MVP jobs:

- heat-vulnerability-zones
- tree-canopy-equity
- housing-violations-near-schools
- transit-accessibility-score
- health-environment-risk

## Environment Configuration

Web client optional Firebase settings (apps/web/.env):

- VITE_API_BASE_URL
- VITE_FIREBASE_API_KEY
- VITE_FIREBASE_AUTH_DOMAIN
- VITE_FIREBASE_PROJECT_ID
- VITE_FIREBASE_STORAGE_BUCKET
- VITE_FIREBASE_MESSAGING_SENDER_ID
- VITE_FIREBASE_APP_ID

In local development mode, auth can be bypassed for API publishing with dev identity behavior.

## Deployment Notes

Firebase deployment helper:

```bash
./scripts/deploy_firebase.sh
```

Rules/index deployment:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

## Product Roadmap (From Here To Final)

Near-term priorities:

- Harden 311 ingestion and ZIP/complaint-type normalization.
- Automate offline embedding generation, quantization, and Firestore publishing.
- Add reference parity fixtures and CI checks for ONNX models.
- Add training data QA checks (missing ZIPs, sparse complaint classes, outliers).
- Build offline batch training script and reproducible model registry metadata.
- Expose simple forecast explorer views in web/mobile clients.

Reference planning document: plan.md
