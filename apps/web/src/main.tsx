import React from "react";
import ReactDOM from "react-dom/client";
import {
  Activity,
  ArrowUpRight,
  BrainCircuit,
  Cloud,
  Database,
  LogIn,
  LogOut,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  getSelectorDataset,
  publishRun,
  runCatalogIngest,
  searchDatasets,
  type DatasetSearchResult,
  type SelectorDataset,
} from "./api";
import {
  EMBEDDING_MODELS,
  type EmbeddingModel,
  cosineSimilarity,
  embedText,
} from "./clientCompute";
import { ACTIVE_RELEASE } from "./forecast/releaseManifest";
import {
  runLocalForecast,
  type ForecastServiceResult,
} from "./forecast/forecastService";
import { getForecastUserMessage } from "./forecast/forecastErrors";
import { getBearerTokenOrDevToken, isFirebaseConfigured, listenAuth, signInWithGoogle, signOutUser } from "./firebase";
import { listRuns, putRun, type RunRecord } from "./localStore";
import "./styles.css";

const FORECAST_MODELS = ["random_forest", "xgboost", "lightgbm"] as const;
type ForecastModelName = (typeof FORECAST_MODELS)[number];

function App() {
  const [question, setQuestion] = React.useState(
    "Which neighborhoods have rising 311 heat complaints but low tree coverage?"
  );
  const [results, setResults] = React.useState<DatasetSearchResult[]>([]);
  const [model, setModel] = React.useState<EmbeddingModel>(EMBEDDING_MODELS[0]);
  const [localComputeStatus, setLocalComputeStatus] = React.useState(
    "Waiting for local GPU compute"
  );
  const [runs, setRuns] = React.useState<RunRecord[]>([]);
  const [authEmail, setAuthEmail] = React.useState<string | null>(null);
  const [publishStatus, setPublishStatus] = React.useState<string>("Not published");
  const [ingestStatus, setIngestStatus] = React.useState<string>("Catalog not ingested yet");
  const [loadingIngest, setLoadingIngest] = React.useState(false);
  const [loadingSearch, setLoadingSearch] = React.useState(false);
  const [featured, setFeatured] = React.useState<SelectorDataset | null>(null);
  const [loadingFeatured, setLoadingFeatured] = React.useState(false);
  const [forecast, setForecast] = React.useState<ForecastServiceResult | null>(null);
  const [forecastModel, setForecastModel] = React.useState<ForecastModelName>("random_forest");
  const [selectedZip, setSelectedZip] = React.useState<string>("");
  const [selectedComplaintType, setSelectedComplaintType] = React.useState<string>("");
  const [loadingForecast, setLoadingForecast] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const featuredIsMock = featured?.is_mock ?? false;

  React.useEffect(() => {
    listRuns(5)
      .then((items) => setRuns(items))
      .catch(() => undefined);

    const unsubscribe = listenAuth((user) => {
      setAuthEmail(user?.email ?? null);
    });

    return unsubscribe;
  }, []);

  React.useEffect(() => {
    if (!featured || featured.combinations.length === 0) {
      setSelectedZip("");
      setSelectedComplaintType("");
      return;
    }

    const uniqueZips = Array.from(
      new Set(featured.combinations.map((c) => c.zipcode))
    ).sort();
    const uniqueTypes = Array.from(
      new Set(featured.combinations.map((c) => c.complaint_type))
    ).sort();

    setSelectedZip((prev) => (prev && uniqueZips.includes(prev) ? prev : uniqueZips[0] ?? ""));
    setSelectedComplaintType((prev) =>
      prev && uniqueTypes.includes(prev) ? prev : uniqueTypes[0] ?? ""
    );
  }, [featured]);

  async function handleIngestClick() {
    setError(null);
    setLoadingIngest(true);
    try {
      const summary = await runCatalogIngest(200, 100);
      setIngestStatus(
        `Run ${summary.ingest_run_id.slice(0, 8)}: scanned ${summary.datasets_scanned}, selected ${summary.datasets_selected}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingest request failed");
    } finally {
      setLoadingIngest(false);
    }
  }

  async function handleLoadFeaturedClick() {
    setError(null);
    setLoadingFeatured(true);
    try {
      const result = await getSelectorDataset();
      if (result.status === "ready") {
        setFeatured(result.dataset);
      } else if (result.status === "empty") {
        setFeatured(null);
        setError("No forecast combinations are available for this release.");
      } else {
        setFeatured(null);
        setError(result.reason || "Selector dataset is unavailable.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Selector dataset request failed");
    } finally {
      setLoadingFeatured(false);
    }
  }

  async function handleForecastClick() {
    if (!selectedZip || !selectedComplaintType) return;
    setError(null);
    setLoadingForecast(true);
    try {
      const result = await runLocalForecast(
        {
          releaseId: ACTIVE_RELEASE.releaseId,
          sourceYear: ACTIVE_RELEASE.sourceYear,
          zipcode: selectedZip,
          complaintType: selectedComplaintType,
        },
        forecastModel
      );
      setForecast(result);
    } catch (err) {
      setError(getForecastUserMessage(err));
    } finally {
      setLoadingForecast(false);
    }
  }

  async function handleSearchClick() {
    setError(null);
    setLoadingSearch(true);
    try {
      setLocalComputeStatus("Running WebGPU embeddings locally...");
      const queryEmbedding = await embedText(question, model);

      const found = await searchDatasets(question);

      const scored = await Promise.all(
        found.map(async (row) => {
          const datasetText = `${row.title}\n${row.description}\n${row.category}\n${row.agency_name}`;
          const rowEmbedding = await embedText(datasetText, model);
          const score = cosineSimilarity(queryEmbedding.vector, rowEmbedding.vector);
          return {
            ...row,
            local_score: score,
          };
        })
      );

      scored.sort((a, b) => b.local_score - a.local_score);
      setResults(scored);

      const runRecord = {
        id: crypto.randomUUID(),
        question,
        model,
        queryEmbeddingKey: queryEmbedding.key,
        selectedDatasetIds: scored.slice(0, 5).map((r) => r.dataset_id),
        createdAt: new Date().toISOString(),
      };
      await putRun(runRecord);
      const latestRuns = await listRuns(5);
      setRuns(latestRuns);

      setLocalComputeStatus(
        `Local compute complete (${queryEmbedding.cached ? "cache hit" : "new embedding"})`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dataset search failed");
      setLocalComputeStatus("Local compute failed");
    } finally {
      setLoadingSearch(false);
    }
  }

  async function handlePublish(run: RunRecord) {
    setError(null);
    setPublishStatus("Publishing run...");
    try {
      const token = await getBearerTokenOrDevToken();
      const result = await publishRun(
        {
          run_id: run.id,
          question: run.question,
          model_name: run.model,
          embedding_key: run.queryEmbeddingKey,
          selected_dataset_ids: run.selectedDatasetIds,
          result_payload: {
            question: run.question,
            selected_dataset_ids: run.selectedDatasetIds,
            created_at: run.createdAt,
          },
        },
        token
      );
      setPublishStatus(`Published ${result.run_id} at ${result.created_on_ts ?? "unknown time"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
      setPublishStatus("Publish failed");
    }
  }

  return (
    <main className="app" id="top">
      <header className="app-header">
        <div className="topbar">
          <a className="brand" href="#top" aria-label="CivicGrid NYC home">
            <span className="brand-mark" aria-hidden="true">
              <MapPin size={20} strokeWidth={2.4} />
            </span>
            <span>CivicGrid <strong>NYC</strong></span>
          </a>
          <nav className="workspace-nav" aria-label="Workspace navigation">
            <a href="#ask">Dataset search</a>
            <a href="#forecast">Forecast</a>
            <a href="#system">System</a>
          </nav>
          <div className="auth-controls">
          {authEmail ? (
            <>
              <span className="account-label">{authEmail}</span>
              <button className="button-secondary" type="button" onClick={() => void signOutUser()}>
                <LogOut size={16} aria-hidden="true" />
                Sign out
              </button>
            </>
          ) : (
            <button className="button-secondary" type="button" onClick={() => void signInWithGoogle()}>
              <LogIn size={16} aria-hidden="true" />
              Sign in with Google
            </button>
          )}
          </div>
        </div>

        <div className="masthead">
          <div className="masthead-copy">
            <p className="eyebrow">Local-first civic forecasting</p>
            <h1>See where 311 demand may move next.</h1>
            <p>
              Explore complaint patterns by ZIP code and compare three models,
              with every prediction computed on this device.
            </p>
          </div>
          <div className="release-strip" aria-label="Active release status">
            <span><Activity size={15} aria-hidden="true" /> Active release</span>
            <strong>{ACTIVE_RELEASE.releaseId}</strong>
            <span><ShieldCheck size={15} aria-hidden="true" /> {publishStatus}</span>
          </div>
        </div>
      </header>

      {error ? <p className="global-alert" role="alert">{error}</p> : null}

      <section className="panel ask-panel" id="ask">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Open data discovery</p>
            <h2>Ask NYC datasets</h2>
          </div>
          <span className="status-chip"><BrainCircuit size={15} aria-hidden="true" /> Browser compute</span>
        </div>
        <p className="section-intro">
          Search the NYC catalog and rerank results locally with a browser embedding model.
        </p>
        <div className="controls">
          <button type="button" onClick={handleIngestClick} disabled={loadingIngest}>
            <RefreshCw size={16} aria-hidden="true" />
            {loadingIngest ? "Ingesting..." : "Ingest NYC Catalog"}
          </button>
          <span className="status">{ingestStatus}</span>
        </div>

        <label htmlFor="question-input">Question</label>
        <textarea
          id="question-input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={3}
        />

        <label htmlFor="model-select">Embedding model (browser GPU)</label>
        <select
          id="model-select"
          value={model}
          onChange={(event) => setModel(event.target.value as EmbeddingModel)}
        >
          {EMBEDDING_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <div className="controls">
          <button type="button" onClick={handleSearchClick} disabled={loadingSearch}>
            <Search size={16} aria-hidden="true" />
            {loadingSearch ? "Computing + Searching..." : "Run Local GPU Compute + Find Datasets"}
          </button>
          <span className="status">{localComputeStatus}</span>
        </div>

        <ul className="result-list">
          {results.map((row) => (
            <li key={row.dataset_id} className="result-item">
              <h3>{row.title}</h3>
              <p>{row.description || "No description available."}</p>
              <p className="meta">
                <strong>{row.category}</strong> | {row.agency_name} | rows: {row.rows_count}
              </p>
              <p className="meta">Local embedding score: {(row as DatasetSearchResult & { local_score?: number }).local_score?.toFixed(4) ?? "n/a"}</p>
              <a href={row.source_url} target="_blank" rel="noreferrer">
                Open dataset API <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>

        <h3>Local Run History (IndexedDB)</h3>
        <ul className="result-list">
          {runs.map((run) => (
            <li key={run.id} className="result-item">
              <strong>{run.question}</strong>
              <p className="meta">
                {run.model} | {new Date(run.createdAt).toLocaleString()}
              </p>
              <button type="button" onClick={() => void handlePublish(run)}>
                <Upload size={16} aria-hidden="true" />
                Publish to Firebase-backed API
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel forecast-panel" id="forecast">
        <div className="section-heading">
          <div>
            <p className="eyebrow">2026 outlook</p>
            <h2>311 forecast workspace</h2>
          </div>
          <span className={`status-chip ${featuredIsMock ? "status-chip-warning" : "status-chip-live"}`}>
            <Database size={15} aria-hidden="true" />
            {featured
              ? featuredIsMock
                ? `Mock selector data (${featured.combinations.length} combinations)`
                : `Live selector data (${featured.combinations.length} combinations)`
              : "Dataset not loaded"}
          </span>
        </div>
        <p className="section-intro">
          Compare heat and street-condition complaint forecasts by ZIP using the active 2025 release.
        </p>
        <div className="controls">
          <button type="button" onClick={handleLoadFeaturedClick} disabled={loadingFeatured}>
            <Database size={16} aria-hidden="true" />
            {loadingFeatured ? "Loading..." : "Load 311 Release"}
          </button>
          {featured ? (
            <span className="status" data-testid="release-status">
              {featuredIsMock ? "Mock release" : "Live release"} {featured.release_id} —{" "}
              <span data-testid="combination-count">{featured.combinations.length} combinations</span>
            </span>
          ) : null}
        </div>

        {featured ? (
          <>
            {featuredIsMock ? (
              <p className="warning">
                Selector options are using the bundled demo sample. Forecast
                records still load from Firestore when Firebase is configured.
              </p>
            ) : null}
            {!isFirebaseConfigured() ? (
              <p className="warning">
                Firebase is not configured. Forecasts are running against local
                mock data.
              </p>
            ) : null}
            <p className="meta">
              <strong>Release {featured.release_id}</strong> |{" "}
              {featured.combinations.length} valid combinations | target year{" "}
              {featured.target_year}
            </p>
            <div
              className="table-scroll"
              role="region"
              aria-label="Available ZIP and complaint-type combinations"
              tabIndex={0}
            >
              <table className="featured-table">
                <thead>
                  <tr>
                    <th>ZIP</th>
                    <th>Complaint Type</th>
                  </tr>
                </thead>
                <tbody>
                  {featured.combinations.map((combo) => (
                    <tr key={`${combo.zipcode}::${combo.complaint_type}`}>
                      <td>{combo.zipcode}</td>
                      <td>{combo.complaint_type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="forecast-controls">
              <div className="control-field">
                <label htmlFor="forecast-zip-select">ZIP code</label>
                <select
                  id="forecast-zip-select"
                  value={selectedZip}
                  onChange={(event) => setSelectedZip(event.target.value)}
                  disabled={!featured}
                >
                  {Array.from(
                    new Set(featured.combinations.map((c) => c.zipcode))
                  )
                    .sort()
                    .map((zip) => (
                      <option key={zip} value={zip}>
                        {zip}
                      </option>
                    ))}
                </select>
              </div>

              <div className="control-field">
                <label htmlFor="forecast-type-select">Complaint type</label>
                <select
                  id="forecast-type-select"
                  value={selectedComplaintType}
                  onChange={(event) =>
                    setSelectedComplaintType(event.target.value)
                  }
                  disabled={!featured}
                >
                  {featured.combinations
                    .filter((c) => c.zipcode === selectedZip)
                    .map((c) => c.complaint_type)
                    .sort()
                    .map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                </select>
              </div>

              <div className="control-field">
                <label htmlFor="forecast-model-select">Forecast model</label>
                <select
                  id="forecast-model-select"
                  value={forecastModel}
                  onChange={(event) =>
                    setForecastModel(event.target.value as ForecastModelName)
                  }
                >
                  {FORECAST_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="forecast-action"
                type="button"
                onClick={handleForecastClick}
                disabled={loadingForecast || !selectedZip || !selectedComplaintType}
              >
                <BrainCircuit size={18} aria-hidden="true" />
                {loadingForecast ? "Predicting..." : "Predict 2026 locally"}
              </button>
            </div>

            {forecast ? (
              <div className="forecast-result" aria-live="polite">
                <div className="result-heading">
                  <div>
                    <p className="eyebrow">2026 local prediction</p>
                    <h3>{forecast.zipcode} · {forecast.complaintType}</h3>
                  </div>
                  <span className="status-chip status-chip-live"><Activity size={15} aria-hidden="true" /> Complete</span>
                </div>
                <div className="prediction-value">
                  <strong>{forecast.prediction.toFixed(0)}</strong>
                  <span>predicted complaints</span>
                </div>
                <div className="metric-grid">
                  <div><span>Model</span><strong data-testid="forecast-model-name">{forecast.modelName.replace("_", " ")}</strong></div>
                  <div><span>Validation MAE</span><strong>{forecast.mae.toFixed(2)}</strong></div>
                  <div><span>Validation RMSE</span><strong>{forecast.rmse.toFixed(2)}</strong></div>
                </div>
                <p className="warning">
                  Forecasts are estimates based on historical patterns and should not be
                  used as the sole basis for policy or operational decisions. Model
                  quality varies by ZIP code and complaint type.
                </p>
                <details>
                  <summary>Provenance</summary>
                  <ul className="result-list">
                    <li>Dataset version: {forecast.provenance.dataset_version}</li>
                    <li>Embedding version: {forecast.provenance.embedding_version}</li>
                    <li>Feature schema: {forecast.provenance.feature_schema_version}</li>
                    <li>Source year: {forecast.provenance.source_year}</li>
                    <li>Target year: {forecast.provenance.target_year}</li>
                    <li>Model name: {forecast.provenance.model_name}</li>
                    <li>Model version: {forecast.provenance.model_version}</li>
                    <li>Model checksum: {forecast.provenance.model_checksum}</li>
                    <li>Embedding checksum: {forecast.provenance.embedding_checksum}</li>
                    <li>Firestore release: {forecast.provenance.firestore_release_id}</li>
                    <li>Record generated at: {forecast.provenance.generated_at}</li>
                    <li>Runtime: {forecast.provenance.local_runtime}</li>
                    <li>Execution provider: {forecast.provenance.execution_provider}</li>
                  </ul>
                </details>
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="system-band" id="system">
        <div className="section-heading">
          <div>
            <p className="eyebrow">System map</p>
            <h2>Local by design</h2>
          </div>
        </div>
        <div className="system-grid">
          <div><Database size={20} aria-hidden="true" /><span><strong>NYC Open Data</strong>Versioned source records</span></div>
          <div><BrainCircuit size={20} aria-hidden="true" /><span><strong>On-device models</strong>Browser ONNX inference</span></div>
          <div><Cloud size={20} aria-hidden="true" /><span><strong>Firebase</strong>Artifacts and provenance</span></div>
        </div>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
