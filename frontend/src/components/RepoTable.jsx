import React from "react";

export default function RepoTable({ repos, loading, error }) {
  if (loading) {
    return (
      <div className="card loading-state">
        <div className="spinner" />
        <p>Scanning repos for recent commits…</p>
        <p style={{ fontSize: 12, marginTop: 6, color: "#5e6c84" }}>
          This may take 20–40 seconds while querying all CM repositories.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card error-state">
        <p>Failed to load repositories.</p>
        <p style={{ fontSize: 12, marginTop: 6 }}>{error}</p>
      </div>
    );
  }

  if (!repos) return null;

  if (repos.length === 0) {
    return (
      <div className="card empty-state">
        <p>No repositories had commits in the selected date range.</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Repository</th>
              <th>Commits</th>
              <th>Last Commit</th>
              <th>Authors</th>
            </tr>
          </thead>
          <tbody>
            {repos.map((repo, idx) => (
              <tr key={repo.slug}>
                <td style={{ color: "#5e6c84", width: 40 }}>{idx + 1}</td>
                <td className="repo-name">
                  <a href={repo.repo_url} target="_blank" rel="noopener noreferrer">
                    {repo.name}
                  </a>
                </td>
                <td>
                  <span className="commit-badge">{repo.commit_count}</span>
                </td>
                <td style={{ whiteSpace: "nowrap", color: "#42526e" }}>
                  {repo.last_commit_date}
                </td>
                <td>
                  <div className="author-list">
                    {repo.authors.map((a) => (
                      <span className="author-chip" key={a}>
                        {a}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
