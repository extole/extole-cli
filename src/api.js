import fetch from 'node-fetch';
import { API_BASE, getSuClientForToken } from './config.js';
import { logRequest } from './utils.js';

const REQUEST_TIMEOUT_MS = 30_000;
const APP_TYPE = 'extole-cli';

/**
 * Format a server error response body for display. Falls back to raw text
 * (capped at 2000 chars) for non-JSON responses. For Extole's structured
 * error envelope ({ code, message, parameters, unique_id }), produces a
 * compact multi-line format that surfaces the unique_id (for support
 * correlation) and pretty-prints any parameters payload — avoids the prior
 * mid-string truncation that dropped binding details on errors like
 * webhook_associated_with_webhook_controller_action.
 */
export function formatApiErrorBody(text) {
  if (!text) return '';
  let parsed;
  try { parsed = JSON.parse(text); } catch { return text.slice(0, 2000); }
  if (!parsed || typeof parsed !== 'object') return text.slice(0, 2000);
  const lines = [];
  if (parsed.code) lines.push(parsed.code);
  if (parsed.message) lines.push(parsed.message);
  if (parsed.unique_id) lines.push(`unique_id: ${parsed.unique_id} (share with Extole support for correlation)`);
  if (parsed.parameters && Object.keys(parsed.parameters).length > 0) {
    lines.push('parameters:');
    lines.push(JSON.stringify(parsed.parameters, null, 2).split('\n').map(l => '  ' + l).join('\n'));
  }
  return lines.length > 0 ? '\n' + lines.join('\n') : text.slice(0, 2000);
}

export async function apiFetch(path, token, options = {}, fetchFn = fetch) {
  const baseUrl = options.baseUrl || API_BASE;
  const sep = path.includes('?') ? '&' : '?';
  const url = `${baseUrl}${path}${sep}app_type=${APP_TYPE}`;
  logRequest(options.verbose, options.method || 'GET', url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.body || null,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const res = await fetchFn(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        'Accept': 'application/json',
        'x-extole-app-type': APP_TYPE,
        ...(options.headers || {}),
      },
    });
    return res;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function apiJson(path, token, options = {}, fetchFn = fetch) {
  const res = await apiFetch(path, token, options, fetchFn);
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) {
      const suClient = getSuClientForToken(token);
      if (suClient) {
        throw new Error(`Token expired — auth su tokens are valid for 2 hours. Re-mint: extole auth su --token <SU_TOKEN> --client ${suClient}`);
      }
      throw new Error(`API error 401: authentication failed — token may be expired`);
    }
    throw new Error(`API error ${res.status}: ${formatApiErrorBody(text)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
}
