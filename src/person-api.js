import { apiJson } from './api.js';
import { API_BASE } from './config.js';

export async function findPerson(email, token, verbose = false) {
  const results = await apiJson(
    `/v5/persons?identity_key_value=${encodeURIComponent(email)}&limit=1`,
    token,
    { verbose, baseUrl: API_BASE }
  );
  if (!results || results.length === 0) return null;
  return results[0];
}

export async function getPersonSteps(personId, token, limit = 50, verbose = false, { causeEventId } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (causeEventId) params.set('causeEventIds', causeEventId);
  return apiJson(
    `/v5/persons/${personId}/steps?${params}`,
    token,
    { verbose, baseUrl: API_BASE }
  );
}

export async function getPersonRelationships(personId, token, verbose = false) {
  return apiJson(`/v5/persons/${personId}/relationships`, token, { verbose, baseUrl: API_BASE });
}

export async function getPersonStats(personId, token, verbose = false) {
  const [stats, networkStats] = await Promise.all([
    apiJson(`/v4/persons/${personId}/stats`, token, { verbose, baseUrl: API_BASE }),
    apiJson(`/v4/persons/${personId}/network-stats`, token, { verbose, baseUrl: API_BASE }),
  ]);
  return { stats, networkStats };
}
