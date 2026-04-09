import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mintClientToken } from '../src/commands/auth.js';

function makeFetch({ status = 200, ok = true, body = '' }) {
  return async () => ({
    ok,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

test('mintClientToken returns access_token on success', async () => {
  const fetchFn = makeFetch({ body: { access_token: 'client-tok-abc' } });
  const token = await mintClientToken('su-token', '12345', false, fetchFn);
  assert.equal(token, 'client-tok-abc');
});

test('mintClientToken throws on non-ok HTTP response', async () => {
  const fetchFn = makeFetch({ status: 403, ok: false, body: 'Forbidden' });
  await assert.rejects(
    () => mintClientToken('su-token', '12345', false, fetchFn),
    /Failed to mint client token for 12345: 403/
  );
});

test('mintClientToken throws on non-JSON response body', async () => {
  const fetchFn = makeFetch({ body: 'not json at all' });
  await assert.rejects(
    () => mintClientToken('su-token', '12345', false, fetchFn),
    /Unexpected response/
  );
});

test('mintClientToken throws when access_token missing from response', async () => {
  const fetchFn = makeFetch({ body: { something_else: 'value' } });
  await assert.rejects(
    () => mintClientToken('su-token', '12345', false, fetchFn),
    /No access_token in response/
  );
});

test('mintClientToken throws on network error', async () => {
  const fetchFn = async () => { throw new Error('network failure'); };
  await assert.rejects(
    () => mintClientToken('su-token', '12345', false, fetchFn),
    /Failed to mint client token for 12345: network failure/
  );
});
