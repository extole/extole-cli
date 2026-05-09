import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, apiJson, formatApiErrorBody } from '../src/api.js';

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

test('formatApiErrorBody returns empty string for empty input', () => {
  assert.equal(formatApiErrorBody(''), '');
  assert.equal(formatApiErrorBody(null), '');
});

test('formatApiErrorBody returns raw text (capped) for non-JSON', () => {
  assert.equal(formatApiErrorBody('plain text error'), 'plain text error');
  const long = 'x'.repeat(3000);
  assert.equal(formatApiErrorBody(long).length, 2000);
});

test('formatApiErrorBody pretty-prints structured errors', () => {
  const body = JSON.stringify({
    code: 'webhook_associated_with_webhook_controller_action',
    message: "Can't archive or disable a webhook associated with webhook controller actions",
    unique_id: '7637655546697208989',
    parameters: {
      webhook_id: 'edb70dc4',
      webhook_controller_actions: [
        { campaign_id: 'cmp-1', controller_id: 'ctrl-a', controller_name: 'Advocate Code Created' },
      ],
    },
  });
  const out = formatApiErrorBody(body);
  assert.match(out, /webhook_associated_with_webhook_controller_action/);
  assert.match(out, /unique_id: 7637655546697208989/);
  assert.match(out, /share with Extole support for correlation/);
  assert.match(out, /webhook_controller_actions/);
  assert.match(out, /Advocate Code Created/);
  // Full parameters payload preserved (not truncated mid-string)
  assert.match(out, /controller_id/);
  assert.match(out, /campaign_id/);
});

test('formatApiErrorBody falls back to raw text when parameters absent', () => {
  const body = JSON.stringify({ code: 'simple_error', message: 'short message' });
  const out = formatApiErrorBody(body);
  assert.match(out, /simple_error/);
  assert.match(out, /short message/);
});
