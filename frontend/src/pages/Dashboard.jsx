import { useState, useEffect, useMemo, useCallback } from 'react'
import { fetchTrace, fetchCommitFiles, fetchCommitDiff, fetchTests } from '../utils/api'

// ─── Shared helpers ──────────────────────────────────────────────────────────

const STATUS_BADGE = {
  matched:       { cls: 'badge-matched',    icon: '✓', label: 'Matched' },
  no_ticket:     { cls: 'badge-no-ticket',  icon: '—', label: 'No ticket' },
  no_component:  { cls: 'badge-no-mapping', icon: '⚠', label: 'No component' },
  no_permission: { cls: 'badge-no-tag',     icon: '🔒', label: 'No permission' },
}

function StatusBadge({ status }) {
  const b = STATUS_BADGE[status] ?? { cls: 'badge-no-ticket', icon: '?', label: status }
  return <span className={`badge ${b.cls}`}>{b.icon} {b.label}</span>
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// ─── By Repo view ────────────────────────────────────────────────────────────

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

function CommitCard({ trace, expanded, onToggle }) {
  const ticketList = trace.tickets.length > 0
    ? trace.tickets.map(t => <span key={t} className="ticket-tag">{t}</span>)
    : <span className="muted">No ticket ID in commit message</span>

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

  return (
    <div className="commit-card">
      <div className="commit-header" onClick={onToggle}>
        <span className="commit-toggle">{expanded ? '▾' : '▸'}</span>
        <div className="commit-header-text">
          <div className="commit-message">{trace.message}</div>
          <div className="commit-info">{trace.author} &bull; {formatDate(trace.timestamp)} &bull; {trace.commit_id}</div>
        </div>
        <StatusBadge status={trace.status} />
      </div>
      {expanded && (
        <div className="pipeline-steps">
          <Step num="①" label="Repo"        value={<span>{trace.repo}</span>} status="ok" />
          <Step num="②" label="Ticket"      value={ticketList}                 status={step2Status} />
          <Step num="③" label="Jira ticket" value={step3Display}               status={step3Status} />
          <Step num="④" label="Test search" value={step4Display}               status={step4Status} />
        </div>
      )}
    </div>
  )
}

function RepoSection({ repo, commits, expandedIds, onToggleCommit }) {
  const [repoOpen, setRepoOpen] = useState(true)
  const matched = commits.filter(c => c.status === 'matched').length
  const gaps    = commits.length - matched

  return (
    <div className="repo-section">
      <div className="repo-header" onClick={() => setRepoOpen(o => !o)}>
        <span style={{ fontSize: 11, opacity: 0.7 }}>{repoOpen ? '▾' : '▸'}</span>
        <span>📁</span>
        <span>{repo}</span>
        <span className="repo-count">{commits.length} commit{commits.length !== 1 ? 's' : ''}</span>
        <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.75 }}>
          ✓ {matched} &nbsp;|&nbsp; ⚠ {gaps}
        </span>
      </div>
      {repoOpen && commits.map(c => (
        <CommitCard
          key={c.commit_id + c.tickets.join()}
          trace={c}
          expanded={expandedIds.has(c.commit_id + c.tickets.join())}
          onToggle={() => onToggleCommit(c.commit_id + c.tickets.join())}
        />
      ))}
    </div>
  )
}

function ByRepoView({ grouped, expandedIds, onToggleCommit, onExpandAll, onCollapseAll }) {
  return (
    <div>
      <div className="view-toolbar">
        <span className="view-count">{grouped.length} repo{grouped.length !== 1 ? 's' : ''}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={onExpandAll}>Expand all</button>
          <button className="btn-secondary" onClick={onCollapseAll}>Collapse all</button>
        </div>
      </div>
      {grouped.map(([repo, commits]) => (
        <RepoSection
          key={repo}
          repo={repo}
          commits={commits}
          expandedIds={expandedIds}
          onToggleCommit={onToggleCommit}
        />
      ))}
    </div>
  )
}

// ─── By Ticket view ──────────────────────────────────────────────────────────

function DiffView({ hunks }) {
  if (!hunks || hunks.length === 0) {
    return <div className="diff-empty">No diff available for this file</div>
  }
  return (
    <div className="diff-view">
      {hunks.map((hunk, hi) => (
        <div key={hi} className="diff-hunk">
          <div className="diff-hunk-header">
            @@ -{hunk.src_line} +{hunk.dst_line} @@
          </div>
          {hunk.lines.map((line, li) => (
            <div key={li} className={`diff-line diff-${line.type.toLowerCase()}`}>
              <span className="diff-ln diff-ln-src">{line.type !== 'ADDED'   ? line.src : ''}</span>
              <span className="diff-ln diff-ln-dst">{line.type !== 'REMOVED' ? line.dst : ''}</span>
              <span className="diff-marker">
                {line.type === 'ADDED' ? '+' : line.type === 'REMOVED' ? '−' : ' '}
              </span>
              <span className="diff-text">{line.text}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

const FILE_TYPE_CLS = { ADD: 'ft-add', MODIFY: 'ft-modify', DELETE: 'ft-delete', RENAME: 'ft-rename', COPY: 'ft-rename' }

function FileRow({ repo, commitId, file }) {
  const [open, setOpen]       = useState(false)
  const [diff, setDiff]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  async function handleClick() {
    if (!open && diff === null && !error) {
      setLoading(true)
      try {
        const data = await fetchCommitDiff(repo, commitId, file.path)
        setDiff(data)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    setOpen(o => !o)
  }

  return (
    <div className="file-row-wrap">
      <div className="file-row" onClick={handleClick}>
        <span className="commit-toggle">{open ? '▾' : '▸'}</span>
        <span className={`ft-badge ${FILE_TYPE_CLS[file.type] || 'ft-modify'}`}>{file.type}</span>
        <span className="file-path">{file.path}</span>
        {loading && <span className="inline-loading">loading…</span>}
      </div>

      {open && !loading && error && (
        <div className="diff-error">
          ⚠ {error}&nbsp;
          <a href={diff?.stash_url} target="_blank" rel="noreferrer">Open in Stash ↗</a>
        </div>
      )}
      {open && !loading && diff && !error && (
        diff.truncated
          ? <div className="diff-too-large">
              ⚠ File too large to display inline.&nbsp;
              <a href={diff.stash_url} target="_blank" rel="noreferrer">Open in Stash ↗</a>
            </div>
          : diff.error
            ? <div className="diff-error">
                ⚠ {diff.error}&nbsp;
                {diff.stash_url && <a href={diff.stash_url} target="_blank" rel="noreferrer">Open in Stash ↗</a>}
              </div>
            : diff.hunks?.length === 0
              ? <div className="diff-empty">
                  No diff data returned by Stash.&nbsp;
                  {diff.stash_url && <a href={diff.stash_url} target="_blank" rel="noreferrer">Open in Stash ↗</a>}
                </div>
              : <DiffView hunks={diff.hunks} />
      )}
    </div>
  )
}

function TicketCommitRow({ trace }) {
  const [open, setOpen]       = useState(false)
  const [files, setFiles]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  async function handleClick() {
    if (!open && files === null && !error) {
      setLoading(true)
      try {
        const data = await fetchCommitFiles(trace.repo, trace.commit_id)
        if (data.error === 'short_sha') {
          setError('Old data — re-run the pipeline to refresh commit IDs')
        } else {
          setFiles(data.files)
        }
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    setOpen(o => !o)
  }

  const shortId = trace.commit_id.slice(0, 8)

  return (
    <div className="ticket-commit-wrap">
      {/* Commit header row */}
      <div className="ticket-commit-row" onClick={handleClick}>
        <span className="commit-toggle">{open ? '▾' : '▸'}</span>
        <span className="repo-slug-tag">{trace.repo}</span>
        <div className="ticket-commit-text">
          <div className="commit-message" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {trace.message}
          </div>
          <div className="commit-info">
            {trace.author} &bull; {formatDate(trace.timestamp)} &bull; {shortId}
          </div>
        </div>
        {loading && <span className="inline-loading">loading files…</span>}
      </div>

      {/* File list */}
      {open && !loading && error && (
        <div className="file-list-error">⚠ Could not load files: {error}</div>
      )}
      {open && !loading && files && (
        <div className="file-list">
          {files.length === 0
            ? <div className="file-empty">No file changes found</div>
            : files.map(f => (
                <FileRow
                  key={f.path}
                  repo={trace.repo}
                  commitId={trace.commit_id}
                  file={f}
                />
              ))
          }
        </div>
      )}
    </div>
  )
}

function TicketCard({ ticket }) {
  const [open, setOpen] = useState(true)
  const repoCount = new Set(ticket.commits.map(c => c.repo)).size

  return (
    <div className="ticket-card">
      <div className="ticket-card-header" onClick={() => setOpen(o => !o)}>
        <span className="commit-toggle">{open ? '▾' : '▸'}</span>
        <span className="ticket-id">{ticket.id}</span>
        <div className="ticket-meta-chips">
          <span className="meta-chip">
            {ticket.commits.length} commit{ticket.commits.length !== 1 ? 's' : ''}
          </span>
          <span className="meta-chip">
            {repoCount} repo{repoCount !== 1 ? 's' : ''}
          </span>
        </div>
        <StatusBadge status={ticket.status} />
      </div>

      {open && (
        <div className="ticket-card-body">
          {/* Ticket metadata */}
          <div className="ticket-details">
            <div className="ticket-detail-row">
              <span className="td-label">Tag</span>
              <span className="td-value">
                {ticket.tag
                  ? <span className="tag-text">{ticket.tag}</span>
                  : ticket.status === 'no_permission'
                    ? <span style={{ color: 'var(--warning)', fontSize: 11 }}>🔒 API permission denied</span>
                    : <span className="muted">No tag field on this ticket</span>
                }
              </span>
            </div>
            <div className="ticket-detail-row">
              <span className="td-label">Component</span>
              <span className="td-value">
                {ticket.components.length > 0
                  ? ticket.components.map(c => <span key={c} className="component-tag">{c}</span>)
                  : <span className="muted">No component — cannot match tests</span>
                }
              </span>
            </div>
            <div className="ticket-detail-row">
              <span className="td-label">Sub-Component</span>
              <span className="td-value muted">Not Defined</span>
            </div>
            <div className="ticket-detail-row">
              <span className="td-label">Test search</span>
              <span className="td-value">
                {ticket.components.length > 0
                  ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {ticket.components.map((c, i) => (
                        <span key={c}>
                          {i > 0 && <span style={{ margin: '0 4px', opacity: 0.5 }}>+</span>}
                          JQL: <code>component = &quot;{c}&quot;</code>
                        </span>
                      ))}
                      {' '}+ Selenium filter
                    </span>
                  : <span className="muted">Skipped — no component</span>
                }
              </span>
            </div>
          </div>

          {/* Commits under this ticket */}
          <div className="ticket-commits-label">
            Commits referencing this ticket
          </div>
          {ticket.commits.map(c => (
            <TicketCommitRow key={c.commit_id + c.repo} trace={c} />
          ))}
        </div>
      )}
    </div>
  )
}

function NoTicketSection({ commits }) {
  const [open, setOpen] = useState(false)
  if (commits.length === 0) return null

  return (
    <div className="ticket-card" style={{ opacity: 0.8 }}>
      <div className="ticket-card-header" onClick={() => setOpen(o => !o)}>
        <span className="commit-toggle">{open ? '▾' : '▸'}</span>
        <span className="ticket-id" style={{ color: 'var(--text-muted)' }}>No Jira Ticket</span>
        <div className="ticket-meta-chips">
          <span className="meta-chip">{commits.length} commit{commits.length !== 1 ? 's' : ''}</span>
        </div>
        <StatusBadge status="no_ticket" />
      </div>
      {open && (
        <div className="ticket-card-body">
          <div className="ticket-details" style={{ marginBottom: 8 }}>
            <div className="ticket-detail-row">
              <span className="td-label">Reason</span>
              <span className="td-value muted">
                No ADINFRA-* or IAPP-* ticket ID found in commit message — cannot trace pipeline further
              </span>
            </div>
          </div>
          {commits.map(c => (
            <TicketCommitRow key={c.commit_id + c.repo} trace={c} />
          ))}
        </div>
      )}
    </div>
  )
}

function ByTicketView({ tickets, noTicketCommits }) {
  const totalTickets = tickets.length
  const matchedTickets = tickets.filter(t => t.status === 'matched').length

  return (
    <div>
      <div className="view-toolbar">
        <span className="view-count">
          {totalTickets} unique ticket{totalTickets !== 1 ? 's' : ''}
          &nbsp;—&nbsp;
          <span style={{ color: 'var(--success)' }}>✓ {matchedTickets} matched</span>
          &nbsp;|&nbsp;
          <span style={{ color: 'var(--error)' }}>⚠ {totalTickets - matchedTickets} gaps</span>
          {noTicketCommits.length > 0 && (
            <span style={{ color: 'var(--text-muted)' }}>
              &nbsp;+&nbsp;{noTicketCommits.length} commits with no ticket
            </span>
          )}
        </span>
      </div>
      {tickets.map(ticket => (
        <TicketCard key={ticket.id} ticket={ticket} />
      ))}
      <NoTicketSection commits={noTicketCommits} />
    </div>
  )
}

// ─── Recommended Tests view ──────────────────────────────────────────────────

const PRIORITY_LABEL = { '1': 'Highest', '2': 'High', '3': 'Medium', '4': 'Low', '5': 'Lowest' }
const PRIORITY_COLOR = { '1': '#dc2626', '2': '#ea580c', '3': '#ca8a04', '4': '#6b7280', '5': '#9ca3af' }

function PriorityBadge({ priorityId }) {
  const id = String(priorityId || '4')
  return (
    <span style={{
      background: PRIORITY_COLOR[id] ?? '#6b7280',
      color: '#fff', borderRadius: 4,
      fontSize: 10, fontWeight: 700, padding: '2px 6px',
      letterSpacing: '0.04em', textTransform: 'uppercase',
    }}>
      {PRIORITY_LABEL[id] ?? 'Low'}
    </span>
  )
}

function ScorePill({ score }) {
  const [bg, label] =
    score >= 1.1 ? ['#dc2626', 'Critical'] :
    score >= 0.8 ? ['#ea580c', 'High']     :
    score >= 0.5 ? ['#ca8a04', 'Medium']   :
                   ['#6b7280', 'Low']
  return (
    <span style={{
      background: bg, color: '#fff', borderRadius: 4,
      fontSize: 10, fontWeight: 700, padding: '2px 6px',
      letterSpacing: '0.04em', textTransform: 'uppercase',
    }}>
      {label}
    </span>
  )
}

const PAGE_SIZE = 20

function RecommendedTestsView({ tests, loading, error }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [tests])

  if (loading) return (
    <div className="state-box">
      <div className="spinner" />
      <div>Running test selector + ranker…</div>
      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
        This queries Jira for each component — takes 30–60s
      </div>
    </div>
  )

  if (error) return (
    <div className="state-box">
      <div className="error-msg">⚠ {error}</div>
    </div>
  )

  if (!tests) return (
    <div className="state-box">
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Click <strong>Load Recommended Tests</strong> to run the ranker.
      </div>
    </div>
  )

  const uniqueComponents = [...new Set(tests.tests.map(t => t.component))].length

  return (
    <div style={{ marginTop: 16 }}>
      {/* Summary strip */}
      <div className="summary-strip" style={{ marginBottom: 16 }}>
        <div className="summary-stat">
          <div className="num">{tests.total_tests}</div>
          <div className="lbl">Test cases</div>
        </div>
        <div className="summary-divider" />
        <div className="summary-stat">
          <div className="num">{uniqueComponents}</div>
          <div className="lbl">Components</div>
        </div>
        <div className="summary-divider" />
        <div className="summary-stat">
          <div className="num" style={{ color: 'var(--error)' }}>{tests.coverage_gaps}</div>
          <div className="lbl">Coverage gaps</div>
        </div>
      </div>

      {/* Test list */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {/* Header row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '48px 110px 1fr 130px 80px 80px 80px',
          padding: '8px 16px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
          letterSpacing: '0.05em', textTransform: 'uppercase',
        }}>
          <span>#</span>
          <span>Jira ID</span>
          <span>Test Summary</span>
          <span>Component</span>
          <span>Priority</span>
          <span>Frequency</span>
          <span>Score</span>
        </div>

        {tests.tests.slice(0, visibleCount).map((t, i) => (
          <div key={t.jira_id} style={{
            display: 'grid',
            gridTemplateColumns: '48px 110px 1fr 130px 80px 80px 80px',
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            alignItems: 'center',
            background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg-secondary)',
            fontSize: 13,
          }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{i + 1}</span>

            <a
              href={`https://jira.mediaocean.com/browse/${t.jira_id}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 12, fontFamily: 'monospace' }}
            >
              {t.jira_id}
            </a>

            <span style={{
              fontSize: 12, color: 'var(--text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              paddingRight: 16,
            }}
              title={t.summary}
            >
              {t.summary}
            </span>

            <span>
              <span className="component-tag" style={{ fontSize: 11 }}>{t.component}</span>
            </span>

            <span>
              <PriorityBadge priorityId={t.ticket_priority_id} />
            </span>

            <span style={{ fontSize: 11, color: t.frequency > 1 ? 'var(--accent)' : 'var(--text-muted)', fontWeight: t.frequency > 1 ? 700 : 400 }}>
              ×{t.frequency} {t.frequency > 1 ? 'tickets' : 'ticket'}
            </span>

            <span><ScorePill score={t.impact_score} /></span>
          </div>
        ))}
      </div>

      {visibleCount < tests.tests.length && (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <button
            onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
            style={{
              padding: '8px 24px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--bg-secondary)', color: 'var(--text)', cursor: 'pointer',
              fontSize: 13, fontWeight: 600,
            }}
          >
            Load more — {tests.tests.length - visibleCount} remaining
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Dashboard shell ─────────────────────────────────────────────────────────

export default function Dashboard() {
  const [days, setDays]         = useState(7)
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [activeTab, setActiveTab] = useState('by-repo')
  const [expandedIds, setExpandedIds] = useState(new Set())
  const [tests, setTests]           = useState(null)
  const [testsLoading, setTestsLoading] = useState(false)
  const [testsError, setTestsError]   = useState(null)

  async function run() {
    setLoading(true)
    setError(null)
    setData(null)
    setTests(null)
    setTestsError(null)
    setExpandedIds(new Set())
    try {
      const result = await fetchTrace(days)
      setData(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadTests() {
    if (tests || testsLoading) return
    setTestsLoading(true)
    setTestsError(null)
    try {
      const result = await fetchTests(days)
      setTests(result)
    } catch (e) {
      setTestsError(e.message)
    } finally {
      setTestsLoading(false)
    }
  }

  const toggleCommit = useCallback((id) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  // By Repo grouping
  const grouped = useMemo(() => {
    if (!data) return []
    const map = new Map()
    for (const t of data.trace) {
      if (!map.has(t.repo)) map.set(t.repo, [])
      map.get(t.repo).push(t)
    }
    return [...map.entries()]
  }, [data])

  const allIds = useMemo(() =>
    data ? data.trace.map(t => t.commit_id + t.tickets.join()) : []
  , [data])

  // By Ticket grouping
  const { tickets, noTicketCommits } = useMemo(() => {
    if (!data) return { tickets: [], noTicketCommits: [] }

    const map = new Map()
    const noTicket = []

    for (const trace of data.trace) {
      if (trace.tickets.length === 0) {
        noTicket.push(trace)
        continue
      }
      for (const ticket of trace.tickets) {
        if (!map.has(ticket)) {
          const tag        = trace.ticket_tags[ticket] || ''
          const components = trace.ticket_components[ticket] || []
          const slugs      = trace.ticket_slugs[ticket] || []
          const permErr    = trace.status === 'no_permission'
          const status     = components.length > 0 ? 'matched'
                           : permErr ? 'no_permission'
                           : 'no_component'
          map.set(ticket, { id: ticket, tag, slugs, components, status, commits: [] })
        }
        map.get(ticket).commits.push(trace)
      }
    }

    // matched first, then alphabetical
    const sorted = [...map.values()].sort((a, b) => {
      if (a.status === 'matched' && b.status !== 'matched') return -1
      if (a.status !== 'matched' && b.status === 'matched') return  1
      return a.id.localeCompare(b.id)
    })

    return { tickets: sorted, noTicketCommits: noTicket }
  }, [data])

  const matched = data?.trace.filter(t => t.status === 'matched').length ?? 0
  const gaps    = data?.trace.filter(t => t.status !== 'matched').length ?? 0

  return (
    <>
      <header className="app-header app-header--single">
        <span>Mediaocean — Pipeline Trace (Component-Based, Approach 1)</span>
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

        {/* Results */}
        {data && !loading && (
          <>
            {/* Summary strip */}
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
                <div className="lbl">Commits</div>
              </div>
              <div className="summary-divider" />
              <div className="summary-stat">
                <div className="num">{tickets.length}</div>
                <div className="lbl">Unique tickets</div>
              </div>
              <div className="summary-divider" />
              <div className="summary-stat">
                <div className="num" style={{ color: 'var(--success)' }}>{matched}</div>
                <div className="lbl">Matched ✓</div>
              </div>
              <div className="summary-divider" />
              <div className="summary-stat">
                <div className="num" style={{ color: 'var(--error)' }}>{gaps}</div>
                <div className="lbl">Gaps ⚠</div>
              </div>
            </div>

            {/* Tab bar */}
            <div className="tab-bar">
              <button
                className={`tab-btn ${activeTab === 'by-repo' ? 'active' : ''}`}
                onClick={() => setActiveTab('by-repo')}
              >
                📁 By Repo
              </button>
              <button
                className={`tab-btn ${activeTab === 'by-ticket' ? 'active' : ''}`}
                onClick={() => setActiveTab('by-ticket')}
              >
                🎫 By Ticket
              </button>
              <button
                className={`tab-btn ${activeTab === 'recommended' ? 'active' : ''}`}
                onClick={() => { setActiveTab('recommended'); loadTests() }}
              >
                🧪 Recommended Tests
              </button>
            </div>

            {/* Tab content */}
            {activeTab === 'by-repo' && (
              <ByRepoView
                grouped={grouped}
                expandedIds={expandedIds}
                onToggleCommit={toggleCommit}
                onExpandAll={() => setExpandedIds(new Set(allIds))}
                onCollapseAll={() => setExpandedIds(new Set())}
              />
            )}
            {activeTab === 'by-ticket' && (
              <ByTicketView
                tickets={tickets}
                noTicketCommits={noTicketCommits}
              />
            )}
            {activeTab === 'recommended' && (
              <RecommendedTestsView
                tests={tests}
                loading={testsLoading}
                error={testsError}
              />
            )}
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
