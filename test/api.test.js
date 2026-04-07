import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, apiJson } from '../src/api.js';

function makeFetch({ status = 200, ok = true, body = '' }) {
  return async () => ({
    ok,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

test('apiFetch sets Authorization and Content-Type headers', async () => {
  let capturedOpts;
  const fetchFn = async (url, opts) => { capturedOpts = opts; return { ok: true, status: 200, text: async () => '' }; };

  await apiFetch('/test', 'my-token', {}, fetchFn);

  assert.equal(capturedOpts.headers['Authorization'], 'Bearer my-token');
  assert.equal(capturedOpts.headers['Content-Type'], 'application/json');
  assert.equal(capturedOpts.headers['Accept'], 'application/json');
});

test('apiFetch allows caller headers to override defaults', async () => {
  let capturedOpts;
  const fetchFn = async (url, opts) => { capturedOpts = opts; return { ok: true, status: 200, text: async () => '' }; };

  await apiFetch('/test', 'tok', { headers: { 'Accept': 'text/plain' } }, fetchFn);

  assert.equal(capturedOpts.headers['Accept'], 'text/plain');
});

test('apiJson returns parsed JSON on success', async () => {
  const result = await apiJson('/programs', 'tok', {}, makeFetch({ body: { id: 42 } }));
  assert.equal(result.id, 42);
});

test('apiJson throws on non-ok response', async () => {
  await assert.rejects(
    () => apiJson('/programs', 'bad-token', {}, makeFetch({ status: 401, ok: false, body: 'Unauthorized' })),
    /API error 401/
  );
});

test('apiJson throws on non-JSON response body', async () => {
  await assert.rejects(
    () => apiJson('/programs', 'tok', {}, makeFetch({ body: 'not json' })),
    /Non-JSON response/
  );
});

test('apiFetch throws on AbortError (timeout simulation)', async () => {
  const fetchFn = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  await assert.rejects(() => apiFetch('/test', 'tok', {}, fetchFn), /timed out/);
});
