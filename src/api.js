import fetch from 'node-fetch';
import { BASE_URL } from './config.js';

export async function apiFetch(path, token, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {}),
    },
  });
  return res;
}

export async function apiJson(path, token, options = {}) {
  const res = await apiFetch(path, token, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}
