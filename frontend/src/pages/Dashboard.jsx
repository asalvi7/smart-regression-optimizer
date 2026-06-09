import React, { useEffect, useState } from "react";
import DateRangeFilter from "../components/DateRangeFilter.jsx";
import RepoTable from "../components/RepoTable.jsx";
import { fetchActiveRepos } from "../services/api.js";

export default function Dashboard() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function load(params) {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchActiveRepos(params);
      setResult(data);
    } catch (err) {
      const message =
        err.response?.data?.detail || err.message || "An unexpected error occurred.";
      setError(message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  // Load default range on mount
  useEffect(() => {
    load({ range: "last_30d" });
  }, []);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Smart Regression Optimizer</h1>
          <div className="subtitle">
            Mediaocean · Campaign Management · Bitbucket Stash
          </div>
        </div>
      </header>

      <main className="page-content">
        <DateRangeFilter onApply={load} loading={loading} />

        {result && !loading && (
          <div className="summary-banner">
            <div className="stat">
              <span className="stat-value">{result.active_repos}</span>
              <span className="stat-label">Active repos</span>
            </div>
            <div className="divider" />
            <div className="stat">
              <span className="stat-value">{result.total_repos_scanned}</span>
              <span className="stat-label">Total repos scanned</span>
            </div>
            <div className="divider" />
            <div className="range-info">
              Showing commits from{" "}
              <strong>{result.date_range.from_date}</strong> to{" "}
              <strong>{result.date_range.to_date}</strong>
            </div>
          </div>
        )}

        <RepoTable
          repos={result?.repos ?? null}
          loading={loading}
          error={error}
        />
      </main>
    </>
  );
}
