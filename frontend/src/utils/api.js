const BASE = '/api'

export async function fetchTrace(sincedays) {
  const res = await fetch(`${BASE}/trace?since_days=${sincedays}`)
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`)
  return res.json()
}
