# CivicMesh Weekly Mission

Week of: 2026-08-04
Deadline: Friday at the end of the assigned week

## One-Week Assignment

This brief covers one Monday-to-Friday workweek. The team owns the task list together, while the supervisor assigns specific items to each intern based on current priorities and skills.

- Confirm individual assignments before work begins.
- All code, research, evidence, and handoff materials are due by Friday.
- Interns are responsible only for the tasks assigned to them.
- Work that does not fit within the week must be documented as follow-up work.

## Goal For The Week

Move the deployed 311 forecasting workflow toward a reliable public release. The local ONNX forecast works, but the live selector currently falls back to a small mock dataset, model quality needs stronger evidence, and browser release coverage is missing.

## Current Starting Point

- Work from the latest `main` branch.
- Run `npm --prefix apps/web ci`, `npm --prefix apps/web test`, and `npm --prefix apps/web run build` before making changes.
- The active frontend release is `20260729-022708`.
- Real forecasts use the `nycdata` Firestore database and local ONNX models.
- The deployed featured-dataset request falls through to `http://localhost:8000` and loads the bundled mock dataset.
- The Firestore release contains 300 valid ZIP and complaint-type records, but the live selector exposes only two ZIP codes.
- Do not commit `.env` files, credentials, downloaded production data, or generated build directories.

## Tasks For The Week

### Production Selector And Release Data

- Run the web app and confirm the current test/build baseline.
- Reproduce the production mock fallback and capture the request path and UI state.
- Trace how `getFeaturedDataset`, Firestore, and the forecast selectors exchange data.
- Compare a Firestore selector manifest with a bundled versioned manifest and document the recommended approach.
- Implement the approved selector-manifest reader.
- Populate ZIP and complaint-type controls from valid release combinations.
- Prevent production from requesting `localhost`.
- Restrict mock data to an explicit development/test mode.
- Add loading, empty, invalid-data, and unavailable-release states.
- Display the release ID, combination count, and live/mock status near the selectors.

Expected result: all valid release combinations are reachable without silently presenting mock data as production data.

### Model And Data Research

- Review the feature schema, release builder, training script, and model card.
- Document the train/validation split and identify leakage or imputation risks.
- List unresolved `DRAFT`, `TBD`, taxonomy, and ZIP-normalization decisions.
- Implement a naive persistence baseline where next year equals the current year.
- Add seasonal trend or moving-average baselines where the data supports them.
- Calculate MAE, RMSE, median absolute error, and weighted absolute percentage error.
- Run rolling year-pair backtests instead of relying only on the 2024-to-2025 holdout.
- Compare Random Forest, XGBoost, LightGBM, and naive baselines.
- Break metrics down by complaint type, ZIP, and complaint-volume band.
- Investigate XGBoost's train/validation gap and LightGBM zero or negative predictions.
- Identify the ten largest absolute errors for domain review.
- Run an ablation with and without the deterministic hash embedding.
- Recommend a default model only if it beats the approved baseline.

Expected result: reproducible evaluation artifacts and a concise report explaining model quality, failure modes, and recommended next experiments.

### Browser QA And Reliability

- Map the forecast happy path and existing unit coverage.
- Propose Playwright coverage and Firebase Emulator usage.
- Add approved browser-test configuration and a release-flow smoke test.
- Test ZIP, complaint type, and model selection.
- Assert prediction, metrics, caveat, release ID, and provenance.
- Confirm the forecast flow makes no backend inference request.
- Cover missing records, unavailable Firestore, checksum failures, version mismatches, and missing models.
- Verify a cache hit avoids a second Firestore record read.
- Test keyboard navigation and visible focus states.
- Check the interface at 390 px, 768 px, and 1440 px widths.
- Fix overflow, overlap, or unreadable status text found during testing.

Expected result: deterministic browser coverage with desktop and mobile evidence.

### Security And Performance Review

- Analyze production `npm audit` findings and identify affected runtime paths.
- Research supported Firebase and Transformers upgrade paths.
- Do not run `npm audit fix --force`.
- Measure initial JavaScript, WASM, model load, cold inference, warm inference, and cache-hit inference.
- Recommend practical bundle-size and latency budgets.

Expected result: a prioritized security and performance report with actionable recommendations.

### Validation And Friday Handoff

- Run the full web test suite and production build.
- Verify forecast results for all three models using a known record.
- Confirm production makes no request to `localhost` and no forecast action calls a backend inference endpoint.
- Update relevant setup and behavior documentation.
- Include commands, results, screenshots, and remaining risks in the pull request or research report.
- Prepare a short Friday demonstration and respond to review feedback.

Expected result: reviewed work that another contributor can reproduce and continue next week.

## Rules For Every Intern

1. Create a branch from current `main`; do not commit directly to `main`.
2. Keep commits focused and use a pull request for review.
3. Raise scope problems early and document unfinished work as follow-up tasks.
4. Add tests for changed behavior and include the commands run in the pull request.
5. Do not deploy Firebase, alter Firestore rules, publish a release, or rotate dependencies without supervisor approval.
6. Do not use production service-account credentials or include secrets in screenshots, logs, issues, or commits.
7. Do not claim model improvement without comparing against a reproducible baseline.
8. Stop and ask the supervisor when a task requires a product, data-governance, security, or deployment decision.

## Friday Supervisor Review

Use this checklist for each intern:

- Assigned work stayed within the agreed weekly scope.
- Required artifact or pull request is linked.
- Tests and build results are included.
- Research claims are supported by data or source references.
- No credentials, environment files, or generated artifacts are committed.
- Remaining risks and decisions are stated plainly.
- The next task is small enough for the following week.
