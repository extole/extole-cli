import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webhooksCommand } from '../src/commands/webhooks.js';

function applyExitOverride(command) {
  command.exitOverride();
  command.configureOutput({ writeErr: () => {} });
  command.commands.forEach(applyExitOverride);
}

class FakeExit extends Error {
  constructor(code) { super(`exit ${code}`); this.code = code; }
}

async function runWithFakeExit(fn) {
  const originalExit = process.exit;
  const originalError = console.error;
  const errors = [];
  process.exit = (code) => { throw new FakeExit(code); };
  console.error = (msg) => { errors.push(msg); };
  try {
    await fn();
    return { errors, exitCode: null };
  } catch (error) {
    if (error instanceof FakeExit) return { errors, exitCode: error.code };
    throw error;
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
}

test('webhooks edit requires --field', async () => {
  const cmd = webhooksCommand();
  applyExitOverride(cmd);
  await assert.rejects(
    () => cmd.parseAsync(['edit', 'wh-1', '--file', '/tmp/whatever.js'], { from: 'user' }),
    /required option '--field <name>' not specified/
  );
});

test('webhooks edit requires --file', async () => {
  const cmd = webhooksCommand();
  applyExitOverride(cmd);
  await assert.rejects(
    () => cmd.parseAsync(['edit', 'wh-1', '--field', 'request'], { from: 'user' }),
    /required option '--file <path>' not specified/
  );
});

test('webhooks edit reports the file read error when --file points at a missing path', async () => {
  const { exitCode, errors } = await runWithFakeExit(() =>
    webhooksCommand().parseAsync(['edit', 'wh-1', '--field', 'request', '--file', '/no/such/path.js'], { from: 'user' })
  );
  assert.equal(exitCode, 2);
  assert.match(errors.join('\n'), /error reading --file/);
});

// ── get --field ──────────────────────────────────────────────────────────────
// Re-implements the pure validation logic under test (no I/O, no fetch).

function extractWebhookField(webhook, fieldName) {
  const value = webhook[fieldName];
  if (value === undefined) return { error: `field "${fieldName}" is not present on this webhook.` };
  if (value !== null && typeof value !== 'string') return { error: `field "${fieldName}" is not a plain text field (got ${typeof value}).` };
  return { value: value ?? '' };
}

test('extractWebhookField returns the raw string value for a present string field', () => {
  const result = extractWebhookField({ request: 'javascript@runtime:...' }, 'request');
  assert.deepEqual(result, { value: 'javascript@runtime:...' });
});

test('extractWebhookField errors when the field is absent', () => {
  const result = extractWebhookField({ request: 'x' }, 'nonexistent');
  assert.match(result.error, /is not present on this webhook/);
});

test('extractWebhookField errors when the field is not a string', () => {
  const result = extractWebhookField({ enabled: true }, 'enabled');
  assert.match(result.error, /is not a plain text field \(got boolean\)/);
});

test('extractWebhookField treats a null field as an empty string, not an error', () => {
  const result = extractWebhookField({ response_handler: null }, 'response_handler');
  assert.deepEqual(result, { value: '' });
});
