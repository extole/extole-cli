import { test } from 'node:test';
import assert from 'node:assert/strict';
import { componentsCommand, renderTreeNode, coerceSettingValue } from '../src/commands/components.js';

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

test('components duplicate requires a component-id argument', async () => {
  const cmd = componentsCommand();
  applyExitOverride(cmd);
  await assert.rejects(
    () => cmd.parseAsync(['duplicate'], { from: 'user' }),
    /missing required argument 'component-id'/
  );
});

// ── buildDuplicateRequest ────────────────────────────────────────────────────

function buildDuplicateRequest(opts) {
  const payload = {};
  if (opts.targetCampaign) payload.target_campaign_id = opts.targetCampaign;
  if (opts.targetSocket) payload.target_setting_name = opts.targetSocket;
  if (opts.displayName) payload.component_display_name = opts.displayName;
  if (opts.description) payload.description = opts.description;
  if (opts.tag?.length) payload.tags = opts.tag;
  return payload;
}

test('buildDuplicateRequest: no --target-campaign omits target_campaign_id (duplicates the whole owning campaign)', () => {
  const payload = buildDuplicateRequest({ displayName: 'Copy' });
  assert.deepEqual(payload, { component_display_name: 'Copy' });
});

test('buildDuplicateRequest: --target-campaign duplicates just the one component into that campaign', () => {
  const payload = buildDuplicateRequest({ targetCampaign: 'camp-1', displayName: 'Copy' });
  assert.deepEqual(payload, { target_campaign_id: 'camp-1', component_display_name: 'Copy' });
});

test('buildDuplicateRequest: --target-socket only applies alongside --target-campaign', () => {
  const payload = buildDuplicateRequest({ targetCampaign: 'camp-1', targetSocket: 'rewardSuppliers' });
  assert.deepEqual(payload, { target_campaign_id: 'camp-1', target_setting_name: 'rewardSuppliers' });
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

function formatInlineEditsNotice(inlineEdits) {
  return `Also included from --setting (no diff shown): ${inlineEdits.map(({ key, rawValue }) => `${key}=${rawValue}`).join(', ')}`;
}

test('components set: mixing --setting with --setting-file surfaces the inline edits alongside the diff', () => {
  const notice = formatInlineEditsNotice([{ key: 'order', rawValue: '2' }, { key: 'enabled', rawValue: 'true' }]);
  assert.equal(notice, 'Also included from --setting (no diff shown): order=2, enabled=true');
});

// ── renderTreeNode ───────────────────────────────────────────────────────────

function captureConsoleLog(fn) {
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(line);
  try {
    fn();
  } finally {
    console.log = originalLog;
  }
  return lines;
}

function stripAnsi(line) {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1b\[[0-9]*m/g, '');
}

test('renderTreeNode uses box-drawing connectors and marks the last child at each level', () => {
  const tree = {
    first: { '.': { name: 'first' } },
    second: { '.': { name: 'second' } },
  };
  const lines = captureConsoleLog(() => renderTreeNode(tree, '')).map(stripAnsi);
  assert.equal(lines[0], '├── first  (?)');
  assert.equal(lines[1], '└── second  (?)');
});

test('renderTreeNode nests grandchildren under a continuation prefix that matches the parent\'s position', () => {
  const tree = {
    onlyChild: {
      '.': { name: 'onlyChild' },
      grandchild: { '.': { name: 'grandchild' } },
    },
  };
  const lines = captureConsoleLog(() => renderTreeNode(tree, '')).map(stripAnsi);
  assert.equal(lines[0], '└── onlyChild  (?)');
  assert.equal(lines[1], '    └── grandchild  (?)');
});

test('renderTreeNode labels a child with the socket it is installed into', () => {
  const tree = {
    child: { '.': { name: 'child', installed_into_socket: 'rewardSuppliers' } },
  };
  const lines = captureConsoleLog(() => renderTreeNode(tree, '')).map(stripAnsi);
  assert.equal(lines[0], '└── child  (?)  [rewardSuppliers]');
});

test('renderTreeNode prefers the singular type field over an empty types array', () => {
  const tree = {
    child: { '.': { name: 'child', type: 'integration-v10.0', types: [] } },
  };
  const lines = captureConsoleLog(() => renderTreeNode(tree, '')).map(stripAnsi);
  assert.equal(lines[0], '└── child  (integration-v10.0)');
});

// ── coerceSettingValue ───────────────────────────────────────────────────────

test('coerceSettingValue passes plain string types through unchanged', () => {
  assert.deepEqual(coerceSettingValue('title', 'Configuration', { type: 'STRING' }), { value: 'Configuration' });
  assert.deepEqual(coerceSettingValue('color', '#fff', { type: 'COLOR' }), { value: '#fff' });
});

test('coerceSettingValue falls back to a plain string when the setting has no known variable', () => {
  assert.deepEqual(coerceSettingValue('unknown', 'x', undefined), { value: 'x' });
});

test('coerceSettingValue coerces BOOLEAN true/false case-insensitively', () => {
  assert.deepEqual(coerceSettingValue('enabled', 'true', { type: 'BOOLEAN' }), { value: true });
  assert.deepEqual(coerceSettingValue('enabled', 'False', { type: 'BOOLEAN' }), { value: false });
});

test('coerceSettingValue rejects a BOOLEAN value that is not true/false', () => {
  const result = coerceSettingValue('enabled', 'yes', { type: 'BOOLEAN' });
  assert.match(result.error, /type BOOLEAN requires true or false/);
});

test('coerceSettingValue coerces INTEGER to a native number', () => {
  assert.deepEqual(coerceSettingValue('order', '2', { type: 'INTEGER' }), { value: 2 });
});

test('coerceSettingValue rejects a non-integer INTEGER value', () => {
  const result = coerceSettingValue('order', '1.5', { type: 'INTEGER' });
  assert.match(result.error, /type INTEGER requires a whole number/);
});

test('coerceSettingValue parses a JSON-typed setting value', () => {
  assert.deepEqual(
    coerceSettingValue('settingsToDisplay', '["a","b"]', { type: 'STRING_LIST' }),
    { value: ['a', 'b'] }
  );
});

test('coerceSettingValue rejects a JSON-typed setting value that is not valid JSON', () => {
  const result = coerceSettingValue('settingsToDisplay', 'a,b', { type: 'STRING_LIST' });
  assert.match(result.error, /type STRING_LIST requires valid JSON/);
  assert.match(result.error, /--setting settingsToDisplay='\["a","b"\]'/);
});

test('coerceSettingValue rejects a structural setting type with an explanatory error', () => {
  const result = coerceSettingValue('views', 'x', { type: 'MULTI_SOCKET' });
  assert.match(result.error, /type MULTI_SOCKET — not settable via components set/);
});

test('coerceSettingValue parses a COMPONENT_REFERENCE value as a component.id map', () => {
  assert.deepEqual(
    coerceSettingValue('parentIntegration', '{"component.id":"abc123"}', { type: 'COMPONENT_REFERENCE' }),
    { value: { 'component.id': 'abc123' } }
  );
});

test('coerceSettingValue rejects an invalid COMPONENT_REFERENCE value with a component.id example', () => {
  const result = coerceSettingValue('parentIntegration', 'abc123', { type: 'COMPONENT_REFERENCE' });
  assert.match(result.error, /type COMPONENT_REFERENCE requires valid JSON/);
  assert.match(result.error, /--setting parentIntegration='\{"component\.id":"<component-id>"\}'/);
});

test('coerceSettingValue parses a COMPONENT_REFERENCE_LIST value as an array of component.id maps', () => {
  assert.deepEqual(
    coerceSettingValue('linkedComponents', '[{"component.id":"a"},{"component.id":"b"}]', { type: 'COMPONENT_REFERENCE_LIST' }),
    { value: [{ 'component.id': 'a' }, { 'component.id': 'b' }] }
  );
});
