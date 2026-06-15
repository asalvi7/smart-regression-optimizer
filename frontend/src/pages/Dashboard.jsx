import { useState, useMemo } from 'react'
import { fetchTrace } from '../utils/api'

const STATUS_BADGE = {
  matched:       { cls: 'badge-matched',    icon: '✓', label: 'Matched' },
  no_ticket:     { cls: 'badge-no-ticket',  icon: '—', label: 'No ticket' },
  no_component:  { cls: 'badge-no-mapping', icon: '⚠', label: 'No component' },
  no_permission: { cls: 'badge-no-tag',     icon: '🔒', label: 'Jira API: no permission' },
}

function StatusBadge({ status }) {
  const b = STATUS_BADGE[status] ?? { cls: 'badge-no-ticket', icon: '?', label: status }
  return <span className={`badge ${b.cls}`}>{b.icon} {b.label}</span>
}

function Step({ num, label, value, status }) {
  const cls = status === 'ok' ? 'step-ok' : status === 'warn' ? 'step-warn' : 'step-skip'
  return (
    <div className={`step ${cls}`}>
      <span className="step-num">{num}</span>
      <span className="step-label">{label}</span>
      <span className="step-value">{value}</span>
    </div>
  )
}

function CommitCard({ trace }) {
  const date = new Date(trace.timestamp).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  // Build step 2: tickets
  const ticketList = trace.tickets.length > 0
    ? trace.tickets.map(t => <span key={t} className="ticket-tag">{t}</span>)
    : <span className="muted">No ticket ID in commit message</span>

  // Step 3: tag + component from Jira ticket
  const step3Display = trace.tickets.length === 0
    ? <span className="muted">N/A — no ticket</span>
    : Object.entries(trace.ticket_tags).map(([ticket, tag]) => {
        const comps = trace.ticket_components[ticket] || []
        return (
          <div key={ticket} style={{ marginBottom: 4 }}>
            <span className="ticket-tag">{ticket}</span>
            <div style={{ marginLeft: 8, marginTop: 2 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Tag: </span>
              {tag
                ? <span style={{ fontSize: 12 }}>{tag}</span>
                : trace.status === 'no_permission'
                  ? <span style={{ color: 'var(--warning)', fontSize: 11 }}>🔒 API permission denied — check JIRA_TOKEN in .env</span>
                  : <span className="muted">No tag field</span>}
            </div>
            <div style={{ marginLeft: 8, marginTop: 2 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Component: </span>
              {comps.length > 0
                ? comps.map(c => <span key={c} className="component-tag">{c}</span>)
                : <span className="muted">No component on ticket</span>}
            </div>
            <div style={{ marginLeft: 8, marginTop: 2 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Sub-Component: </span>
              <span className="muted">Subcomponent Not Defined</span>
            </div>
          </div>
        )
      })

  // Step 4: test search JQL
  const allComponents = Object.values(trace.ticket_components).flat()
  const step4Display = allComponents.length === 0
    ? <span className="muted">Cannot search — no component found</span>
    : (
      <span>
        Will search: {allComponents.map(c => <span key={c} className="component-tag">{c}</span>)}
        <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>
          + Selenium automated filter
        </span>
      </span>
    )

  const step2Status = trace.tickets.length > 0 ? 'ok' : 'warn'
  const step3Status = trace.tickets.length === 0 ? 'skip'
    : Object.values(trace.ticket_components).some(v => v.length > 0) ? 'ok' : 'warn'
  const step4Status = allComponents.length > 0 ? 'ok' : 'warn'
  const compEntries = Object.entries(trace.ticket_components)

  return (
    <div className="commit-card">
      <div className="commit-meta">
        <div>
          <div className="commit-message">{trace.message}</div>
          <div className="commit-info">{trace.author} &bull; {date} &bull; {trace.commit_id}</div>
        </div>
        <StatusBadge status={trace.status} />
      </div>
      <div className="pipeline-steps">
        <Step num="①" label="Repo" value={<span>{trace.repo}</span>} status="ok" />
        <Step num="②" label="Ticket" value={ticketList} status={step2Status} />
        <Step num="③" label="Jira ticket" value={step3Display} status={step3Status} />
        <Step num="④" label="Test search" value={step4Display} status={step4Status} />
      </div>
    </div>
  )
}

function RepoSection({ repo, commits }) {
  return (
    <div className="repo-section">
      <div className="repo-header">
        <span>📁</span>
        <span>{repo}</span>
        <span className="repo-count">{commits.length} commit{commits.length !== 1 ? 's' : ''}</span>
      </div>
      {commits.map(c => <CommitCard key={c.commit_id + c.tickets.join()} trace={c} />)}
    </div>
  )
}

export default function Dashboard() {
  const [days, setDays] = useState(7)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function run() {
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const result = await fetchTrace(days)
      setData(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Group trace by repo, preserving order of first appearance
  const grouped = useMemo(() => {
    if (!data) return []
    const map = new Map()
    for (const t of data.trace) {
      if (!map.has(t.repo)) map.set(t.repo, [])
      map.get(t.repo).push(t)
    }
    return [...map.entries()]
  }, [data])

  const matched = data?.trace.filter(t => t.status === 'matched').length ?? 0
  const gaps    = data?.trace.filter(t => t.status !== 'matched').length ?? 0

  return (
    <>
      <header className="app-header">
        <h1>Smart Regression Optimizer</h1>
        <span>Mediaocean — Pipeline Trace</span>
      </header>

      <div className="page">
        {/* Filter bar */}
        <div className="filter-bar">
          <label>Time window</label>
          <select value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button className="btn-run" onClick={run} disabled={loading}>
            {loading ? '⏳ Running…' : '▶ Run Pipeline'}
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="state-box">
            <div className="spinner" />
            <div>Scanning repos and fetching Jira data…</div>
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              This takes 30–60s on first run
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="state-box">
            <div className="error-msg">⚠ {error}</div>
            <div style={{ marginTop: 8, fontSize: 12 }}>Is the backend running on port 8000?</div>
          </div>
        )}

        {/* Summary */}
        {data && !loading && (
          <>
            <div className="summary-strip">
              <div className="summary-stat">
                <div className="num">{data.repos_scanned}</div>
                <div className="lbl">Repos scanned</div>
              </div>
              <div className="summary-divider" />
              <div className="summary-stat">
                <div className="num">{data.repos_with_changes}</div>
                <div className="lbl">With changes</div>
              </div>
              <div className="summary-divider" />
              <div className="summary-stat">
                <div className="num">{data.commits_processed}</div>
                <div className="lbl">Commits processed</div>
              </div>
              <div className="summary-divider" />
              <div className="summary-stat">
                <div className="num" style={{ color: 'var(--success)' }}>{matched}</div>
                <div className="lbl">Matched ✓</div>
              </div>
              <div className="summary-divider" />
              <div className="summary-stat">
                <div className="num" style={{ color: 'var(--error)' }}>{gaps}</div>
                <div className="lbl">Coverage gaps</div>
              </div>
            </div>

            {grouped.map(([repo, commits]) => (
              <RepoSection key={repo} repo={repo} commits={commits} />
            ))}
          </>
        )}

        {/* Empty state */}
        {!data && !loading && !error && (
          <div className="empty-hint">
            <div style={{ fontSize: 32 }}>🔍</div>
            <p>Select a time window and click <strong>Run Pipeline</strong> to trace commits through the 4-step selection process.</p>
          </div>
        )}
      </div>
    </>
  )
}
