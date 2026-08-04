# Forecast311 Validation Report

**Validator:** Ritika Subedi  
**Branch:** `phase-2c-complete`  
**Release ID:** `20260728-164958`  
**Date:** 2026-07-31

---

## 1. Release ID and Manifest Verification

| Item | Status | Details |
|------|--------|---------|
| Active release ID | ✓ Confirmed | `20260728-164958` in `apps/web/src/forecast/releaseManifest.ts` |
| Dataset version | ✓ Confirmed | `nyc311-2025-v1` |
| Embedding version | ✓ Confirmed | `311-embed-v1` |
| Feature schema version | ✓ Confirmed | `forecast-features-v1` |
| Source year | ✓ Confirmed | `2025` |
| Target year | ✓ Confirmed | `2026` |

### Model Artifacts

All three ONNX model files are present in `public/models/forecast311/v1/`:

- `random-forest.onnx`
- `xgboost.onnx`
- `lightgbm.onnx`

`model-card.json` and `checksums.json` are present and consistent.

---

## 2. Frontend Tests and Production Build

### Tests

Command run:

```bash
cd apps/web
npm test
```

Result:

```text
 Test Files  3 passed (3)
      Tests  16 passed (16)
```

### Production Build

Command run:

```bash
cd apps/web
npm run build
```

Result: **Build succeeded** with the expected large WASM chunk warnings for ONNX Runtime.

---

## 3. Record Shape, Checksum, Feature, and Model Output Validation

### Firestore Embedding Records

Queried Firestore release `20260728-164958` in the `nycdata` database.

- **Total records:** 300
- **Unique ZIP + complaint-type combinations:** 300
- **Complaint types in release:** `HEAT/HOT WATER`, `Street Condition`

### Sample Record Validation

Validated three sample records from Firestore:

| ZIP | Complaint Type | Shape | Counts | Trends (3) | Embedding (32) | Checksum |
|-----|----------------|-------|--------|------------|----------------|----------|
| 10000 | HEAT/HOT WATER | ✓ | ✓ | ✓ | ✓ | ✓ |
| 10000 | Street Condition | ✓ | ✓ | ✓ | ✓ | ✓ |
| 10001 | HEAT/HOT WATER | ✓ | ✓ | ✓ | ✓ | ✓ |

All sample records passed shape and checksum verification.

### Model Output Validation (Parity Fixtures)

Ran `scripts/validate_forecast311_parity.py` against `public/models/forecast311/v1/parity-fixtures.json`.

| Model | Expected Prediction | Actual Prediction | Tolerance | Status |
|-------|--------------------:|------------------:|----------:|--------|
| random_forest | 22.838333 | 22.838375 | 0.01 | ✓ |
| xgboost | 22.150402 | 22.150452 | 0.01 | ✓ |
| lightgbm | 24.844291 | 24.844191 | 0.01 | ✓ |

All model checksums in `model-card.json` matched the actual ONNX files.

---

## 4. Browser Inference Confirmation

### Browser Inference Test Results

Tested on http://127.0.0.1:5173/ after configuring `apps/web/.env` and switching `firebase.ts` to the `nycdata` Firestore database.

| # | ZIP | Complaint Type | Model | Prediction | Provenance | Status |
|---|-----|----------------|-------|-----------:|------------|--------|
| 1 | 10025 | heat/hot water | random_forest | 2781.27 | MAE/RMSE + caveat displayed | ✓ |
| 2 | 10025 | street condition | xgboost | 637.19 | MAE/RMSE + caveat displayed | ✓ |
| 3 | 10025 | heat/hot water | lightgbm | 2130.47 | MAE/RMSE + caveat displayed | ✓ |

All three predictions used real Firestore embedding records from release `20260728-164958`. Each result showed:
- Selected model name and version
- Build-time validation MAE and RMSE
- A reproducibility/caveat statement

No mock fallback was triggered.

---

## 5. Data Quality and Model Failures

**No failures found** in automated or manual validation:

- All model files present and checksums match.
- All parity fixtures pass within tolerance.
- All sample Firestore records have valid shape and checksums.
- Frontend tests and production build pass.
- Browser inference succeeds for three real ZIP + complaint-type combinations using all three models.

### Known Observations

1. **Featured dataset source:** The app falls back to the mock featured dataset when Firestore is not configured. With Firebase configured, it loads `config/featuredDataset` from Firestore.
2. **Record count:** The release contains 300 records covering 150 ZIP codes × 2 complaint types.
3. **Case normalization:** Firestore stores complaint types as `HEAT/HOT WATER` and `Street Condition`. The app normalizes to lowercase before building the record ID, so casing in the UI does not affect lookups.
4. **IndexedDB version conflict:** During local testing, the browser had an existing IndexedDB version (4) newer than the code's requested version (3). This was resolved by bumping `DB_VERSION` to 5 in `apps/web/src/localStore.ts`.

### Action Required

- None. Validation is complete. The remaining project work (Firebase Hosting deployment and README update) is owned by Jebonnesa.
