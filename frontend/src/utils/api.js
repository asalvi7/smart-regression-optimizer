const BASE = '/api'

export async function fetchTrace(sincedays) {
  const res = await fetch(`${BASE}/trace?since_days=${sincedays}`)
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`)
  return res.json()
}

export async function fetchTests(sinceDays) {
  const res = await fetch(`${BASE}/tests?since_days=${sinceDays}`)
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`)
  return res.json()
}

export async function fetchCommitFiles(repo, commitId) {
  const res = await fetch(`${BASE}/commits/${repo}/${commitId}/files`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchCommitDiff(repo, commitId, filePath) {
  const res = await fetch(
    `${BASE}/commits/${repo}/${commitId}/diff?path=${encodeURIComponent(filePath)}`
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
