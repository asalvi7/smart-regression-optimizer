import { useState, useEffect, useMemo, useCallback } from 'react'
import { fetchTrace, fetchLatestTrace, fetchCommitFiles, fetchCommitDiff, fetchTests } from '../utils/api'

function formatClockTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

const AUTO_REFRESH_SECONDS = 30

// ─── Shared helpers ──────────────────────────────────────────────────────────

const STATUS_BADGE = {
  matched:       { cls: 'badge-matched',    icon: '✓', label: 'Matched' },
  no_ticket:     { cls: 'badge-no-ticket',  icon: '—', label: 'No ticket' },
  not_prisma:    { cls: 'badge-fallback',   icon: '⊘', label: 'Not Prisma' },
  no_tag:        { cls: 'badge-no-tag',     icon: '⚠', label: 'No tag' },
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
        const subComps = trace.ticket_sub_components?.[ticket] || []
        const isPrisma = trace.ticket_is_prisma?.[ticket] ?? false
        const ticketStatus = trace.ticket_status?.[ticket]
        return (
          <div key={ticket} style={{ marginBottom: 4 }}>
            <span className="ticket-tag">{ticket}</span>
            <div style={{ marginLeft: 8, marginTop: 2 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Product: </span>
              {isPrisma
                ? <span style={{ fontSize: 12 }}>Prisma</span>
                : <span className="muted">Not Prisma — excluded from scope</span>}
            </div>
            <div style={{ marginLeft: 8, marginTop: 2 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Tag: </span>
              {!isPrisma
                ? <span className="muted">Skipped — Product ≠ Prisma</span>
                : tag
                  ? <span style={{ fontSize: 12 }}>{tag}</span>
                  : ticketStatus === 'no_permission'
                    ? <span style={{ color: 'var(--warning)', fontSize: 11 }}>🔒 API permission denied — check JIRA_TOKEN in .env</span>
                    : <span className="muted">No tag field — excluded from scope</span>}
            </div>
            <div style={{ marginLeft: 8, marginTop: 2 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Component: </span>
              {ticketStatus === 'not_prisma' || ticketStatus === 'no_tag'
                ? <span className="muted">Not applicable</span>
                : comps.length > 0
                  ? comps.map(c => <span key={c} className="component-tag">{c}</span>)
                  : <span className="muted">No component on ticket</span>}
            </div>
            <div style={{ marginLeft: 8, marginTop: 2 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Sub-Component: </span>
              {ticketStatus === 'not_prisma' || ticketStatus === 'no_tag'
                ? <span className="muted">Not applicable</span>
                : subComps.length > 0
                  ? subComps.map(sc => <span key={sc} className="component-tag">{sc}</span>)
                  : <span className="muted">Not defined — component-level match only</span>}
            </div>
          </div>
        )
      })

  const allComponents = [...new Set(
    Object.entries(trace.ticket_status || {})
      .filter(([, s]) => s === 'matched')
      .flatMap(([t]) => trace.ticket_components[t] || [])
  )]
  const step4Display = allComponents.length === 0
    ? <span className="muted">Cannot search — no ticket in scope with a component</span>
    : (
      <span>
        Will search: {allComponents.map(c => <span key={c} className="component-tag">{c}</span>)}
        <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>
          + automated regression filter
        </span>
      </span>
    )

  const step2Status = trace.tickets.length > 0 ? 'ok' : 'warn'
  const step3Status = trace.tickets.length === 0 ? 'skip'
    : Object.values(trace.ticket_status || {}).some(s => s === 'matched') ? 'ok' : 'warn'
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

function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'
}

function TimelineCommitRow({ trace, isLast }) {
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
    <div className="timeline-row">
      <div className="timeline-avatar-col">
        <div className="timeline-avatar" onClick={handleClick}>{initials(trace.author)}</div>
        {!isLast && <div className="timeline-line" />}
      </div>
      <div className="timeline-content">
        <div className="timeline-clickable" onClick={handleClick}>
          <div className="timeline-head">
            <span className="repo-slug-tag">{trace.repo}</span>
            <span className="timeline-sha">{shortId}</span>
            {loading && <span className="inline-loading">loading files…</span>}
          </div>
          <div className="commit-message">{trace.message}</div>
          <div className="commit-info">{trace.author} &bull; {formatDate(trace.timestamp)}</div>
        </div>

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
    </div>
  )
}

function TicketCard({ ticket, expanded, onToggle }) {
  const open = expanded
  const repoCount = new Set(ticket.commits.map(c => c.repo)).size
  const tagParts = ticket.tag ? ticket.tag.split(',').map(t => t.trim()).filter(Boolean) : []

  return (
    <div className="ticket-card">
      <div className="ticket-card-header" onClick={onToggle}>
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
        <div className="ticket-card-body ticket-card-body--split">
          {/* Left panel — ticket metadata */}
          <div className="ticket-left-panel">
            {ticket.isPrisma
              ? <span className="prisma-badge">Prisma</span>
              : <span className="muted">Not Prisma — ticket excluded from scope</span>
            }

            <div className="ticket-field">
              <div className="ticket-field-label">Component</div>
              <div className="ticket-field-pills">
                {ticket.status === 'not_prisma' || ticket.status === 'no_tag'
                  ? <span className="muted">Not applicable — ticket excluded above</span>
                  : ticket.components.length > 0
                    ? ticket.components.map(c => <span key={c} className="pill-component">{c}</span>)
                    : <span className="muted">No component — cannot match tests</span>
                }
              </div>
            </div>

            <div className="ticket-field">
              <div className="ticket-field-label">Sub-Component</div>
              <div className="ticket-field-pills">
                {ticket.status === 'not_prisma' || ticket.status === 'no_tag'
                  ? <span className="muted">Not applicable</span>
                  : ticket.subComponents.length > 0
                    ? ticket.subComponents.map(sc => <span key={sc} className="pill-subcomp">{sc}</span>)
                    : <span className="muted">Not defined — component-level match only</span>
                }
              </div>
            </div>

            <div className="ticket-field">
              <div className="ticket-field-label">Tag</div>
              <div className="ticket-tag-boxes">
                {!ticket.isPrisma
                  ? <span className="muted">Skipped — Product ≠ Prisma</span>
                  : tagParts.length > 0
                    ? tagParts.map(t => <div key={t} className="tag-box">{t}</div>)
                    : ticket.status === 'no_permission'
                      ? <span style={{ color: 'var(--warning)', fontSize: 11 }}>🔒 API permission denied</span>
                      : <span className="muted">No tag field — ticket excluded from scope</span>
                }
              </div>
            </div>

            {ticket.status !== 'not_prisma' && ticket.status !== 'no_tag' && (
              <div className="test-search-box">
                <div className="ticket-field-label">Test search</div>
                {ticket.components.length > 0
                  ? <div>
                      Looking for regression tests tagged{' '}
                      {ticket.components.map((c, i) => (
                        <span key={c}>
                          {i > 0 && <> or </>}
                          <strong>{c}</strong>
                          {ticket.subComponents.length > 0 && (
                            <> ({ticket.subComponents.join(' or ')})</>
                          )}
                        </span>
                      ))}
                      {' '}— automated, non-retired regression tests only.
                    </div>
                  : <span className="muted">Skipped — no component</span>
                }
              </div>
            )}
          </div>

          {/* Right panel — commit timeline */}
          <div className="ticket-right-panel">
            <div className="ticket-commits-label">
              Commits referencing this ticket ({ticket.commits.length})
            </div>
            <div className="commit-timeline">
              {ticket.commits.map((c, i) => (
                <TimelineCommitRow
                  key={c.commit_id + c.repo}
                  trace={c}
                  isLast={i === ticket.commits.length - 1}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function NoTicketSection({ commits, expanded, onToggle }) {
  const open = expanded
  if (commits.length === 0) return null

  return (
    <div className="ticket-card" style={{ opacity: 0.8 }}>
      <div className="ticket-card-header" onClick={onToggle}>
        <span className="commit-toggle">{open ? '▾' : '▸'}</span>
        <span className="ticket-id" style={{ color: 'var(--text-muted)' }}>Untracked Commits</span>
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
          <div className="commit-timeline">
            {commits.map((c, i) => (
              <TimelineCommitRow key={c.commit_id + c.repo} trace={c} isLast={i === commits.length - 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const NO_TICKET_KEY = '__no_ticket__'

// Tickets that failed the Product=Prisma / has-Tag scope check are out of
// scope for this tab entirely — they never reach test search, so they don't
// belong on a tab meant to show "what's in scope". Full raw diagnostic
// (including why a ticket was excluded) still lives in ticket_status via the
// API if that's ever needed again.
const OUT_OF_SCOPE_STATUSES = new Set(['not_prisma', 'no_tag'])

function ByTicketView({ tickets, noTicketCommits }) {
  const inScopeTickets = useMemo(
    () => tickets.filter(t => !OUT_OF_SCOPE_STATUSES.has(t.status)),
    [tickets]
  )
  const excludedCount = tickets.length - inScopeTickets.length
  const totalTickets = inScopeTickets.length
  const matchedTickets = inScopeTickets.filter(t => t.status === 'matched').length
  const [expandedIds, setExpandedIds] = useState(new Set())

  const allIds = useMemo(() => {
    const ids = inScopeTickets.map(t => t.id)
    if (noTicketCommits.length > 0) ids.push(NO_TICKET_KEY)
    return ids
  }, [inScopeTickets, noTicketCommits])

  function toggleTicket(id) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div>
      <div className="view-toolbar">
        <span className="view-count" style={{ fontWeight: 700, fontSize: 17, color: 'var(--text)' }}>
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={() => setExpandedIds(new Set(allIds))}>Expand all</button>
          <button className="btn-secondary" onClick={() => setExpandedIds(new Set())}>Collapse all</button>
        </div>
      </div>
      {inScopeTickets.map(ticket => (
        <TicketCard
          key={ticket.id}
          ticket={ticket}
          expanded={expandedIds.has(ticket.id)}
          onToggle={() => toggleTicket(ticket.id)}
        />
      ))}
      <NoTicketSection
        commits={noTicketCommits}
        expanded={expandedIds.has(NO_TICKET_KEY)}
        onToggle={() => toggleTicket(NO_TICKET_KEY)}
      />
    </div>
  )
}

// ─── Recommended Tests view ──────────────────────────────────────────────────

// This Jira instance's priority scheme is custom, not the generic Jira default
// (Highest/High/Medium/Low/Lowest) — confirmed via GET /rest/api/3/priority:
// 1=Critical, 2=High, 3=Medium, 4=Low, 10000=TBD.
const PRIORITY_LABEL = { '1': 'Critical', '2': 'High', '3': 'Medium', '4': 'Low', '10000': 'TBD' }
const PRIORITY_COLOR = { '1': '#dc2626', '2': '#ea580c', '3': '#ca8a04', '4': '#6b7280', '10000': '#9ca3af' }
const PRIORITY_ICON  = { '1': '⊖', '2': '⚑', '3': '≫', '4': '○', '10000': '○' }
// Severity rank for sorting — 0 = most severe (Critical) ... 4 = least (TBD)
const PRIORITY_SEVERITY = { '1': 0, '2': 1, '3': 2, '4': 3, '10000': 4 }
const PRIORITY_FILTERS = ['All', 'Critical', 'High', 'Medium', 'Low', 'TBD']

function PriorityIcon({ priorityId }) {
  const id = String(priorityId || '4')
  return (
    <span className="priority-icon" style={{ color: PRIORITY_COLOR[id] ?? '#6b7280' }} title={PRIORITY_LABEL[id]}>
      {PRIORITY_ICON[id] ?? '○'}
    </span>
  )
}

function PriorityBadge({ priorityId }) {
  const id = String(priorityId || '4')
  return (
    <span style={{
      background: PRIORITY_COLOR[id] ?? '#6b7280',
      color: '#fff', borderRadius: 5,
      fontSize: 11.5, fontWeight: 700, padding: '4px 10px',
      letterSpacing: '0.04em', textTransform: 'uppercase',
      display: 'inline-block',
    }}>
      {PRIORITY_LABEL[id] ?? 'Low'}
    </span>
  )
}

const PAGE_SIZE = 20

function RecommendedTestsView({ tests, loading, error }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  // null = default (backend) order; 'desc' = Critical → TBD; 'asc' = TBD → Critical
  const [prioritySort, setPrioritySort] = useState(null)
  const [priorityFilter, setPriorityFilter] = useState('All')

  useEffect(() => { setVisibleCount(PAGE_SIZE); setPrioritySort(null); setPriorityFilter('All') }, [tests])

  const sortedTests = useMemo(() => {
    if (!tests || !prioritySort) return tests?.tests ?? []
    const dir = prioritySort === 'desc' ? 1 : -1
    return [...tests.tests].sort((a, b) => {
      const ra = PRIORITY_SEVERITY[a.priority_id] ?? 5
      const rb = PRIORITY_SEVERITY[b.priority_id] ?? 5
      return dir * (ra - rb)
    })
  }, [tests, prioritySort])

  const filteredTests = useMemo(() => {
    if (priorityFilter === 'All') return sortedTests
    return sortedTests.filter(t => PRIORITY_LABEL[String(t.priority_id || '4')] === priorityFilter)
  }, [sortedTests, priorityFilter])

  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [priorityFilter])

  function togglePrioritySort() {
    setPrioritySort(prev => prev === 'desc' ? 'asc' : prev === 'asc' ? null : 'desc')
  }

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

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text)', marginBottom: 14 }}>
        {tests.total_tests} test case{tests.total_tests !== 1 ? 's' : ''} recommended
      </div>

      {/* Priority filter */}
      <div className="priority-filter-row">
        {PRIORITY_FILTERS.map(f => (
          <button
            key={f}
            className={`priority-filter-btn ${priorityFilter === f ? 'active' : ''}`}
            onClick={() => setPriorityFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Test list */}
      <div className="tests-table">
        <div className="tests-table-header">
          <span>#</span>
          <span></span>
          <span>Jira ID</span>
          <span>Test Summary</span>
          <span>Component</span>
          <span
            onClick={togglePrioritySort}
            style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
            title="Sort by priority"
          >
            Priority
            <span style={{ fontSize: 10, opacity: prioritySort ? 1 : 0.35 }}>
              {prioritySort === 'asc' ? '▲' : prioritySort === 'desc' ? '▼' : '▲▼'}
            </span>
          </span>
          <span>Frequency</span>
        </div>

        {filteredTests.slice(0, visibleCount).map((t, i) => (
          <div key={t.jira_id} className="tests-row">
            <span className="tests-row-num">{i + 1}</span>

            <PriorityIcon priorityId={t.priority_id} />

            <a
              href={`https://mediaocean.atlassian.net/browse/${t.jira_id}`}
              target="_blank"
              rel="noreferrer"
              className="tests-row-jira"
            >
              {t.jira_id}
            </a>

            <span className="tests-row-summary" title={t.summary}>
              {t.summary}
            </span>

            <span className="tests-row-component">
              <span className="component-tag">{t.component}</span>
            </span>

            <span>
              <PriorityBadge priorityId={t.priority_id} />
            </span>

            <span className={`tests-row-frequency ${t.frequency > 1 ? 'tests-row-frequency--hot' : ''}`}>
              ×{t.frequency} {t.frequency > 1 ? 'tickets' : 'ticket'}
            </span>
          </div>
        ))}
      </div>

      {visibleCount < filteredTests.length && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <button
            onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
            style={{
              padding: '10px 28px', borderRadius: 7, border: '1px solid var(--border)',
              background: 'var(--card)', color: 'var(--primary)', cursor: 'pointer',
              fontSize: 14, fontWeight: 700, boxShadow: 'var(--shadow-sm)',
            }}
          >
            Load more — {filteredTests.length - visibleCount} remaining
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Stat cards ──────────────────────────────────────────────────────────────

function commitsByDay(trace) {
  const map = new Map()
  for (const t of trace) {
    const day = new Date(t.timestamp).toISOString().slice(0, 10)
    map.set(day, (map.get(day) || 0) + 1)
  }
  const days = [...map.keys()].sort()
  const last7 = days.slice(-7)
  return last7.map(d => ({ day: d, count: map.get(d) }))
}

function RepoActivityCard({ scanned, changed }) {
  const pct = scanned > 0 ? Math.round((changed / scanned) * 100) : 0
  const ringStyle = {
    background: `conic-gradient(var(--warning) ${pct * 3.6}deg, var(--neutral-bg) ${pct * 3.6}deg)`,
  }
  return (
    <div className="stat-card">
      <div className="stat-card-label">Repo Activity</div>
      <div className="donut-row">
        <div className="donut-ring" style={ringStyle}>
          <div className="donut-center">
            <div className="donut-pct" style={{ fontSize: 14 }}>{changed}/{scanned}</div>
            <div className="donut-pct-lbl">changed</div>
          </div>
        </div>
        <div className="donut-legend">
          <div className="donut-legend-row">
            <span className="donut-dot" style={{ background: 'var(--warning)' }} /> {changed} changed
          </div>
          <div className="donut-legend-row">
            <span className="donut-dot donut-dot--gap" /> {scanned - changed} unchanged
          </div>
        </div>
      </div>
    </div>
  )
}

function CommitsCard({ total, byDay }) {
  const max = Math.max(1, ...byDay.map(d => d.count))
  return (
    <div className="stat-card stat-card--dark">
      <div className="stat-card-label">Commits</div>
      <div className="stat-card-num">{total}</div>
      <div className="sparkline">
        {byDay.map(d => (
          <span
            key={d.day}
            className="sparkline-bar"
            style={{ height: `${8 + (d.count / max) * 20}px` }}
            title={`${d.day}: ${d.count} commit${d.count !== 1 ? 's' : ''}`}
          />
        ))}
      </div>
    </div>
  )
}

function CoverageDonutCard({ matched, gaps }) {
  const total = matched + gaps
  const pct = total > 0 ? Math.round((matched / total) * 100) : 0
  const ringStyle = {
    background: `conic-gradient(var(--success-mid) ${pct * 3.6}deg, var(--neutral-bg) ${pct * 3.6}deg)`,
  }
  return (
    <div className="stat-card">
      <div className="stat-card-label">Coverage — Matched vs Gaps</div>
      <div className="donut-row">
        <div className="donut-ring" style={ringStyle}>
          <div className="donut-center">
            <div className="donut-pct">{pct}%</div>
            <div className="donut-pct-lbl">matched</div>
          </div>
        </div>
        <div className="donut-legend">
          <div className="donut-legend-row">
            <span className="donut-dot donut-dot--matched" /> {matched} matched
          </div>
          <div className="donut-legend-row">
            <span className="donut-dot donut-dot--gap" /> {gaps} gaps
          </div>
        </div>
      </div>
    </div>
  )
}

function CommitsPerRepoCard({ repoCounts }) {
  const top3 = repoCounts.slice(0, 3)
  const max = Math.max(1, ...top3.map(r => r.count))
  return (
    <div className="stat-card">
      <div className="stat-card-label">Top 3 Repos by Commits</div>
      <div className="repo-bar-list">
        {top3.map(r => (
          <div key={r.repo} className="repo-bar-row">
            <div className="repo-bar-head">
              <span className="repo-bar-name">{r.repo}</span>
              <span className="repo-bar-count">{r.count}</span>
            </div>
            <div className="repo-bar-track">
              <div className="repo-bar-fill" style={{ width: `${(r.count / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatsGrid({ data, matched, gaps, grouped }) {
  const byDay = useMemo(() => commitsByDay(data.trace), [data.trace])
  const repoCounts = useMemo(
    () => grouped.map(([repo, commits]) => ({ repo, count: commits.length }))
      .sort((a, b) => b.count - a.count),
    [grouped]
  )

  return (
    <div className="stats-grid">
      <RepoActivityCard scanned={data.repos_scanned} changed={data.repos_with_changes} />
      <CommitsCard total={data.commits_processed} byDay={byDay} />
      <CoverageDonutCard matched={matched} gaps={gaps} />
      <CommitsPerRepoCard repoCounts={repoCounts} />
    </div>
  )
}

// ─── Dashboard shell ─────────────────────────────────────────────────────────

export default function Dashboard() {
  const [days, setDays]         = useState(7)
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [activeTab, setActiveTab] = useState('by-ticket')
  const [expandedIds, setExpandedIds] = useState(new Set())
  const [tests, setTests]           = useState(null)
  const [testsLoading, setTestsLoading] = useState(false)
  const [testsError, setTestsError]   = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [isCached, setIsCached]       = useState(false)
  const [secondsToRefresh, setSecondsToRefresh] = useState(AUTO_REFRESH_SECONDS)

  function applyCacheResult(result) {
    if (result.trace) {
      setData(result.trace)
      setDays(result.trace.since_days)
      setLastUpdated(result.cached_at)
      setIsCached(true)
    }
  }

  // On mount, show the poller's warm trace cache instantly instead of forcing
  // a live 30-60s Stash+Jira scan on every page load. Falls back silently to
  // the empty state if the poller hasn't produced a cache yet (cold start).
  useEffect(() => {
    fetchLatestTrace().then(applyCacheResult).catch(() => {}) // silent — empty state is a fine fallback
  }, [])

  // Auto-refresh: re-poll the cache (not a live scan) every 30s so an
  // ambient/open dashboard stays current. Only while showing the cached view —
  // pauses once the user runs a manual (possibly custom-window) query, so it
  // doesn't silently overwrite what they asked for.
  useEffect(() => {
    if (!isCached || loading) return
    if (secondsToRefresh <= 0) {
      fetchLatestTrace().then(applyCacheResult).catch(() => {})
      setSecondsToRefresh(AUTO_REFRESH_SECONDS)
      return
    }
    const t = setTimeout(() => setSecondsToRefresh(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [isCached, loading, secondsToRefresh])

  async function run() {
    setLoading(true)
    setError(null)
    setData(null)
    setTests(null)
    setTestsError(null)
    setExpandedIds(new Set())
    setIsCached(false)
    try {
      const result = await fetchTrace(days)
      setData(result)
      setLastUpdated(new Date().toISOString())
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
          const tag          = trace.ticket_tags[ticket] || ''
          const components   = trace.ticket_components[ticket] || []
          const subComponents = trace.ticket_sub_components?.[ticket] || []
          const slugs        = trace.ticket_slugs[ticket] || []
          const isPrisma     = trace.ticket_is_prisma?.[ticket] ?? false
          const status       = trace.ticket_status?.[ticket] || 'no_component'
          map.set(ticket, { id: ticket, tag, slugs, components, subComponents, isPrisma, status, commits: [] })
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

  // Same in-scope filter as the By Ticket tab (Product=Prisma + has Tag) so the
  // top KPI strip and the tab below it always agree on the same numbers.
  const inScopeTickets = useMemo(
    () => tickets.filter(t => !OUT_OF_SCOPE_STATUSES.has(t.status)),
    [tickets]
  )

  const matched = inScopeTickets.filter(t => t.status === 'matched').length
  const gaps    = inScopeTickets.length - matched

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
          <button className="btn-run-combo" onClick={run} disabled={loading} title="Run pipeline now">
            {isCached && !loading && <span className="btn-run-combo-dot" />}
            <span className="btn-run-combo-icon">{loading ? '⏳' : '↻'}</span>
            <span className="btn-run-combo-text">
              <span className="btn-run-combo-main">{loading ? 'Running…' : '▶ Run Pipeline'}</span>
              {lastUpdated && !loading && (
                <span className="btn-run-combo-sub">Updated {formatClockTime(lastUpdated)}</span>
              )}
            </span>
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
            {/* Stat cards */}
            <StatsGrid data={data} matched={matched} gaps={gaps} grouped={grouped} />

            {/* Tab bar */}
            <div className="tab-bar">
              {/* By Repo tab hidden — only By Ticket / Recommended Tests should show.
              <button
                className={`tab-btn ${activeTab === 'by-repo' ? 'active' : ''}`}
                onClick={() => setActiveTab('by-repo')}
              >
                📁 By Repo
              </button>
              */}
              <button
                className={`tab-btn ${activeTab === 'by-ticket' ? 'active' : ''}`}
                onClick={() => setActiveTab('by-ticket')}
              >
                🎫 DEV TICKETS
              </button>
              <button
                className={`tab-btn ${activeTab === 'recommended' ? 'active' : ''}`}
                onClick={() => { setActiveTab('recommended'); loadTests() }}
              >
                🧪 RECOMMENDED TESTS
              </button>
            </div>

            {/* Tab content */}
            {/* By Repo tab hidden — only By Ticket / Recommended Tests should show.
            {activeTab === 'by-repo' && (
              <ByRepoView
                grouped={grouped}
                expandedIds={expandedIds}
                onToggleCommit={toggleCommit}
                onExpandAll={() => setExpandedIds(new Set(allIds))}
                onCollapseAll={() => setExpandedIds(new Set())}
              />
            )}
            */}
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
            <p>Select a time window and click <strong>Run Pipeline</strong>.</p>
          </div>
        )}
      </div>
    </>
  )
}
