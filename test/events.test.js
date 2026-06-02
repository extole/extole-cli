import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test the --data JSON parsing logic inline (mirrors events.js action)
function parseDataOption(jsonString) {
  const data = JSON.parse(jsonString);
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error('must be a JSON object');
  return data;
}

test('--data parses a valid JSON object', () => {
  const result = parseDataOption('{"email":"jane@example.com","amount":"500"}');
  assert.equal(result.email, 'jane@example.com');
  assert.equal(result.amount, '500');
});

test('--data rejects a JSON array', () => {
  assert.throws(() => parseDataOption('[1,2,3]'), /must be a JSON object/);
});

test('--data rejects invalid JSON', () => {
  assert.throws(() => parseDataOption('not-json'));
});

// Test sandbox default logic (mirrors events.js action)
function buildSandboxParam(optsSandbox, optsLive) {
  const sandboxName = optsSandbox === true ? 'production-test' : (optsSandbox || null);
  if (!optsLive) return sandboxName || 'production-test';
  return null;
}

test('sandbox defaults to production-test when no flags passed', () => {
  assert.equal(buildSandboxParam(undefined, undefined), 'production-test');
});

test('sandbox uses explicit name when --sandbox name passed', () => {
  assert.equal(buildSandboxParam('my-sandbox', undefined), 'my-sandbox');
});

test('sandbox uses production-test when --sandbox passed without value', () => {
  assert.equal(buildSandboxParam(true, undefined), 'production-test');
});

test('sandbox is null when --live is passed', () => {
  assert.equal(buildSandboxParam(undefined, true), null);
});
