import fetch from 'node-fetch';
import { BASE_URL } from './config.js';

const REQUEST_TIMEOUT_MS = 30_000;

export async function apiFetch(path, token, options = {}, fetchFn = fetch) {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
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
    throw new Error(`API error ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
}
