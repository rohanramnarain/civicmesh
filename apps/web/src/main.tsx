import React from "react";
import ReactDOM from "react-dom/client";
import {
  getFeaturedDataset,
  publishRun,
  runCatalogIngest,
  runForecast311,
  searchDatasets,
  type DatasetSearchResult,
  type FeaturedDataset,
} from "./api";
import {
  EMBEDDING_MODELS,
  type EmbeddingModel,
  cosineSimilarity,
  embedText,
} from "./clientCompute";
import { getBearerTokenOrDevToken, listenAuth, signInWithGoogle, signOutUser } from "./firebase";
import { listRuns, putRun, type RunRecord } from "./localStore";
import "./styles.css";

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
  const [featured, setFeatured] = React.useState<FeaturedDataset | null>(null);
  const [loadingFeatured, setLoadingFeatured] = React.useState(false);
  const [forecast, setForecast] = React.useState<ForecastResult | null>(null);
  const [loadingForecast, setLoadingForecast] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    listRuns(5)
      .then((items) => setRuns(items))
      .catch(() => undefined);

    const unsubscribe = listenAuth((user) => {
      setAuthEmail(user?.email ?? null);
    });

    return unsubscribe;
  }, []);

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
      const dataset = await getFeaturedDataset();
      setFeatured(dataset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Featured dataset request failed");
    } finally {
      setLoadingFeatured(false);
    }
  }

  async function handleForecastClick() {
    if (!featured) return;
    setError(null);
    setLoadingForecast(true);
    try {
      const result = await runForecast311(featured.rows);
      setForecast(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Forecast request failed");
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
    <main className="app">
      <header>
        <h1>CivicGrid NYC</h1>
        <p>Ask NYC. Contribute compute. Publish reproducible insight cards.</p>
        <div className="controls">
          {authEmail ? (
            <>
              <span className="status">Signed in: {authEmail}</span>
              <button type="button" onClick={() => void signOutUser()}>
                Sign out
              </button>
            </>
          ) : (
            <button type="button" onClick={() => void signInWithGoogle()}>
              Sign in with Google
            </button>
          )}
          <span className="status">{publishStatus}</span>
        </div>
      </header>

      <section className="panel">
        <h2>Ask NYC (Live API)</h2>
        <p>
          Step 1: ingest top NYC datasets. Step 2: run required local WebGPU embedding compute.
          Step 3: search and locally rerank relevant datasets.
        </p>
        <div className="controls">
          <button type="button" onClick={handleIngestClick} disabled={loadingIngest}>
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
            {loadingSearch ? "Computing + Searching..." : "Run Local GPU Compute + Find Datasets"}
          </button>
          <span className="status">{localComputeStatus}</span>
        </div>

        {error ? <p className="error">{error}</p> : null}

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
                Open dataset API
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
                Publish to Firebase-backed API
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Featured Dataset: 311 Complaints by ZIP (2020-2025)</h2>
        <p>
          Pre-loaded sample of NYC 311 heat/hot-water and street-condition complaints
          grouped by ZIP code and year. Safe for offline demos.
        </p>
        <div className="controls">
          <button type="button" onClick={handleLoadFeaturedClick} disabled={loadingFeatured}>
            {loadingFeatured ? "Loading..." : "Load Featured Dataset"}
          </button>
          {featured ? (
            <span className="status">
              {featured.title} — {featured.rows.length} rows
            </span>
          ) : null}
        </div>

        {featured ? (
          <>
            <p className="meta">
              <strong>{featured.agency_name}</strong> | {featured.category} |{" "}
              <a href={featured.source_url} target="_blank" rel="noreferrer">
                Open source dataset
              </a>
            </p>
            <table className="featured-table">
              <thead>
                <tr>
                  <th>ZIP</th>
                  <th>Complaint Type</th>
                  {featured.years.map((year) => (
                    <th key={year}>{year}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from(
                  new Map(
                    featured.rows.map((r) => [
                      `${r.zipcode}::${r.complaint_type}`,
                      { zipcode: r.zipcode, complaint_type: r.complaint_type },
                    ])
                  ).values()
                ).map((key) => {
                  const byYear = new Map(
                    featured.rows
                      .filter(
                        (r) =>
                          r.zipcode === key.zipcode &&
                          r.complaint_type === key.complaint_type
                      )
                      .map((r) => [r.year, r.complaint_count])
                  );
                  return (
                    <tr key={`${key.zipcode}::${key.complaint_type}`}>
                      <td>{key.zipcode}</td>
                      <td>{key.complaint_type}</td>
                      {featured.years.map((year) => (
                        <td key={year}>{byYear.get(year) ?? 0}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="controls">
              <button
                type="button"
                onClick={handleForecastClick}
                disabled={loadingForecast || !featured}
              >
                {loadingForecast ? "Predicting..." : "Predict 2026 from this data"}
              </button>
            </div>

            {forecast ? (
              <>
                <h3>2026 Predictions</h3>
                <p className="meta">
                  Best model by RMSE:{" "}
                  <strong>{forecast.model_comparison[0]?.model_name}</strong> | MAE:{" "}
                  {forecast.model_comparison[0]?.mae} | RMSE:{" "}
                  {forecast.model_comparison[0]?.rmse}
                </p>
                <table className="featured-table">
                  <thead>
                    <tr>
                      <th>ZIP</th>
                      <th>Complaint Type</th>
                      <th>2025 Actual</th>
                      <th>2026 Predicted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.predictions[
                      forecast.model_comparison[0]?.model_name
                    ]?.slice(0, 10).map((row) => (
                      <tr key={`${row.zipcode}::${row.complaint_type}`}>
                        <td>{row.zipcode}</td>
                        <td>{row.complaint_type}</td>
                        <td>{row.source_count}</td>
                        <td>{row.predicted_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="grid">
        <article className="card">
          <h2>Ask NYC</h2>
          <p>Natural-language civic analysis over NYC Open Data.</p>
        </article>
        <article className="card">
          <h2>Civic Compute</h2>
          <p>Simulated local workers contribute verified analysis work-units.</p>
        </article>
        <article className="card">
          <h2>Insight Atlas</h2>
          <p>Queryable, cited, and reproducible public insight cards.</p>
        </article>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
