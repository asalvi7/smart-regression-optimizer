import axios from "axios";

const api = axios.create({
  baseURL: "/api",
  timeout: 120000, // Stash can be slow with many repos
});

/**
 * Fetch repos that had commits in the given date range.
 *
 * @param {Object} params
 * @param {string} [params.range]     - Preset: today | last_7d | last_30d | last_90d
 * @param {string} [params.from]      - Custom start date YYYY-MM-DD
 * @param {string} [params.to]        - Custom end date YYYY-MM-DD
 * @returns {Promise<ActiveReposResponse>}
 */
export async function fetchActiveRepos(params) {
  const { data } = await api.get("/repos/active", { params });
  return data;
}
