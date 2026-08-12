import { test } from 'node:test';
import assert from 'node:assert/strict';
import { componentsCommand } from '../src/commands/components.js';

// ── fake process.exit for testing action-level validation without killing the test runner ──

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

// ── helpers ──────────────────────────────────────────────────────────────────

function makeComponent(overrides = {}) {
  return {
    id: 'cmp-001',
    name: 'my_component',
    display_name: 'My Component',
    type: 'reward-v10.0',
    types: ['reward-v10.0'],
    installed_into_socket: 'rewards',
    campaign_id: 'camp-123',
    component_references: [],
    variables: [],
    ...overrides,
  };
}

// Re-implement the pure logic functions under test (no I/O, no fetch)

function matchesType(component, filter) {
  const f = filter.toLowerCase();
  return (component.types || []).some(t => t.toLowerCase().includes(f));
}

function filterByName(list, substr) {
  const q = substr.toLowerCase();
  return list.filter(c =>
    (c.name || '').toLowerCase().includes(q) ||
    (c.display_name || '').toLowerCase().includes(q)
  );
}

function buildDeployRequest(opts) {
  const isUpdate = !!opts.component;
  const path = isUpdate ? `/v1/components/${opts.component}/upload-bundle` : '/v1/components/upload-bundle';
  const method = isUpdate ? 'PUT' : 'POST';
  return { path, method };
}

function buildProgramParams(opts) {
  const params = {};
  if (opts.program) params.campaign_ids = opts.program;
  return params;
}

function buildTypeMap(components) {
  const map = new Map();
  for (const c of components) {
    const types = c.types || [];
    if (types.length === 0) continue;
    const primary = types[0];
    if (!map.has(primary)) map.set(primary, new Set(types.slice(1)));
  }
  return map;
}

// ── subcommand option isolation ─────────────────────────────────────────────

function applyExitOverride(command) {
  command.exitOverride();
  command.configureOutput({ writeErr: () => {} });
  command.commands.forEach(applyExitOverride);
}

test('components types rejects an option only defined on the parent command', async () => {
  const cmd = componentsCommand();
  applyExitOverride(cmd);
  await assert.rejects(
    () => cmd.parseAsync(['types', '--filter', 'stripe-promotion'], { from: 'user' }),
    /unknown option '--filter'/
  );
});

// ── buildDeployRequest ───────────────────────────────────────────────────────

test('buildDeployRequest: create posts multipart to /v1/components/upload-bundle', () => {
  const { path, method } = buildDeployRequest({});
  assert.equal(path, '/v1/components/upload-bundle');
  assert.equal(method, 'POST');
});

test('buildDeployRequest: update puts multipart to /v1/components/{id}/upload-bundle', () => {
  const { path, method } = buildDeployRequest({ component: '123' });
  assert.equal(path, '/v1/components/123/upload-bundle');
  assert.equal(method, 'PUT');
});

// ── buildProgramParams ───────────────────────────────────────────────────────

test('buildProgramParams: --program maps to plural campaign_ids query param', () => {
  const params = buildProgramParams({ program: '7667297017222816023' });
  assert.equal(params.campaign_ids, '7667297017222816023');
  assert.equal(params.campaign_id, undefined);
});

test('buildProgramParams: no --program produces no filter params', () => {
  assert.deepEqual(buildProgramParams({}), {});
});

// ── matchesType ───────────────────────────────────────────────────────────────

test('matchesType: exact type match', () => {
  const c = makeComponent({ types: ['reward-v10.0'] });
  assert.ok(matchesType(c, 'reward-v10.0'));
});

test('matchesType: substring match on type', () => {
  const c = makeComponent({ types: ['reward-v10.0'] });
  assert.ok(matchesType(c, 'reward'));
});

test('matchesType: matches parent type in types array', () => {
  const c = makeComponent({ types: ['business-event-v10.0', 'targetable-step-event-v10.0'] });
  assert.ok(matchesType(c, 'targetable-step-event'));
});

test('matchesType: no match returns false', () => {
  const c = makeComponent({ types: ['reward-v10.0'] });
  assert.ok(!matchesType(c, 'rule'));
});

test('matchesType: case-insensitive', () => {
  const c = makeComponent({ types: ['Reward-V10.0'] });
  assert.ok(matchesType(c, 'reward'));
});

test('matchesType: empty types array returns false', () => {
  const c = makeComponent({ types: [] });
  assert.ok(!matchesType(c, 'reward'));
});

// ── filterByName ─────────────────────────────────────────────────────────────

test('filterByName: matches on display_name substring', () => {
  const list = [
    makeComponent({ name: 'foo', display_name: 'Gift Card Reward' }),
    makeComponent({ name: 'bar', display_name: 'Pending Rule' }),
  ];
  const result = filterByName(list, 'gift');
  assert.equal(result.length, 1);
  assert.equal(result[0].display_name, 'Gift Card Reward');
});

test('filterByName: matches on name field', () => {
  const list = [
    makeComponent({ name: 'amazon_gift_card', display_name: 'Amazon' }),
    makeComponent({ name: 'pending_period', display_name: 'Pending' }),
  ];
  const result = filterByName(list, 'amazon');
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'amazon_gift_card');
});

test('filterByName: case-insensitive', () => {
  const list = [makeComponent({ name: 'foo', display_name: 'Gift Card' })];
  assert.equal(filterByName(list, 'GIFT').length, 1);
});

test('filterByName: no match returns empty array', () => {
  const list = [makeComponent({ display_name: 'Reward' })];
  assert.equal(filterByName(list, 'rule').length, 0);
});

// ── buildTypeMap ──────────────────────────────────────────────────────────────

test('buildTypeMap: single-type component creates entry with no parents', () => {
  const components = [makeComponent({ types: ['reward-v10.0'] })];
  const map = buildTypeMap(components);
  assert.ok(map.has('reward-v10.0'));
  assert.equal(map.get('reward-v10.0').size, 0);
});

test('buildTypeMap: component with parent types captures parents', () => {
  const components = [
    makeComponent({ types: ['business-event-v10.0', 'targetable-step-event-v10.0'] }),
  ];
  const map = buildTypeMap(components);
  assert.ok(map.has('business-event-v10.0'));
  assert.ok(map.get('business-event-v10.0').has('targetable-step-event-v10.0'));
});

test('buildTypeMap: deduplicates same primary type across multiple components', () => {
  const components = [
    makeComponent({ types: ['reward-v10.0'] }),
    makeComponent({ types: ['reward-v10.0'] }),
  ];
  const map = buildTypeMap(components);
  assert.equal(map.size, 1);
});

test('buildTypeMap: skips components with empty types array', () => {
  const components = [makeComponent({ types: [] })];
  const map = buildTypeMap(components);
  assert.equal(map.size, 0);
});

// ── components set validation ─────────────────────────────────────────────────

test('components set requires --setting or --setting-file', async () => {
  const { exitCode, errors } = await runWithFakeExit(() =>
    componentsCommand().parseAsync(['set', 'cmp-1'], { from: 'user' })
  );
  assert.equal(exitCode, 2);
  assert.match(errors.join('\n'), /at least one --setting key=value or --setting-file key=path/);
});

test('components set rejects --setting-file without an "=" separator', async () => {
  const { exitCode, errors } = await runWithFakeExit(() =>
    componentsCommand().parseAsync(['set', 'cmp-1', '--setting-file', 'no-equals-sign'], { from: 'user' })
  );
  assert.equal(exitCode, 2);
  assert.match(errors.join('\n'), /invalid --setting-file \(expected key=path\)/);
});

test('components set reports the file read error when --setting-file points at a missing path', async () => {
  const { exitCode, errors } = await runWithFakeExit(() =>
    componentsCommand().parseAsync(['set', 'cmp-1', '--setting-file', 'title=/no/such/path.txt'], { from: 'user' })
  );
  assert.equal(exitCode, 2);
  assert.match(errors.join('\n'), /Error reading --setting-file path for "title"/);
});
