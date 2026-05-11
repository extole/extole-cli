import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMaxMindTriggers, filterQualityRules, formatProperties } from '../src/commands/campaigns.js';

function makeMaxMindTrigger(overrides = {}) {
  return {
    trigger_id: 'trig-001',
    trigger_type: 'MAXMIND',
    trigger_phase: 'QUALITY',
    trigger_name: 'MAXMIND',
    enabled: true,
    risk_threshold: 20,
    ip_threshold: 20,
    allow_high_risk_email: false,
    default_quality_score: 'HIGH',
    ...overrides,
  };
}

function makeBuiltCampaign(steps) {
  return { steps };
}

// ── extractMaxMindTriggers ───────────────────────────────────────────────────

test('extractMaxMindTriggers: returns empty array when built has no steps', () => {
  assert.deepEqual(extractMaxMindTriggers({}), []);
  assert.deepEqual(extractMaxMindTriggers(null), []);
  assert.deepEqual(extractMaxMindTriggers(undefined), []);
});

test('extractMaxMindTriggers: walks steps and triggers, returning MAXMIND only', () => {
  const built = makeBuiltCampaign([
    {
      id: 'step-1',
      name: 'converted',
      triggers: [
        { trigger_type: 'EVENT', trigger_name: 'event' },
        makeMaxMindTrigger({ trigger_id: 'mm-1' }),
        { trigger_type: 'LEGACY_QUALITY', trigger_name: 'legacy' },
      ],
    },
  ]);
  const result = extractMaxMindTriggers(built);
  assert.equal(result.length, 1);
  assert.equal(result[0].trigger_id, 'mm-1');
  assert.equal(result[0].step_id, 'step-1');
  assert.equal(result[0].step_name, 'converted');
});

test('extractMaxMindTriggers: excludes disabled triggers by default', () => {
  const built = makeBuiltCampaign([
    {
      id: 'step-1',
      name: 'converted',
      triggers: [
        makeMaxMindTrigger({ trigger_id: 'mm-on', enabled: true }),
        makeMaxMindTrigger({ trigger_id: 'mm-off', enabled: false }),
      ],
    },
  ]);
  const result = extractMaxMindTriggers(built);
  assert.equal(result.length, 1);
  assert.equal(result[0].trigger_id, 'mm-on');
});

test('extractMaxMindTriggers: includes disabled when flag is set', () => {
  const built = makeBuiltCampaign([
    {
      id: 'step-1',
      name: 'converted',
      triggers: [
        makeMaxMindTrigger({ trigger_id: 'mm-on', enabled: true }),
        makeMaxMindTrigger({ trigger_id: 'mm-off', enabled: false }),
      ],
    },
  ]);
  const result = extractMaxMindTriggers(built, { includeDisabled: true });
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(t => t.trigger_id).sort(), ['mm-off', 'mm-on']);
});

test('extractMaxMindTriggers: stamps step_id and step_name on each trigger', () => {
  const built = makeBuiltCampaign([
    {
      id: 'step-1', name: 'converted',
      triggers: [makeMaxMindTrigger({ trigger_id: 'mm-1' })],
    },
    {
      id: 'step-2', name: 'risk_evaluated',
      triggers: [makeMaxMindTrigger({ trigger_id: 'mm-2' })],
    },
  ]);
  const result = extractMaxMindTriggers(built);
  assert.equal(result.length, 2);
  assert.equal(result[0].step_name, 'converted');
  assert.equal(result[1].step_name, 'risk_evaluated');
});

test('extractMaxMindTriggers: surfaces all expected MaxMind fields', () => {
  const built = makeBuiltCampaign([
    {
      id: 'step-1', name: 'converted',
      triggers: [makeMaxMindTrigger({
        risk_threshold: 5,
        ip_threshold: 100,
        allow_high_risk_email: true,
        default_quality_score: 'LOW',
      })],
    },
  ]);
  const [t] = extractMaxMindTriggers(built);
  assert.equal(t.risk_threshold, 5);
  assert.equal(t.ip_threshold, 100);
  assert.equal(t.allow_high_risk_email, true);
  assert.equal(t.default_quality_score, 'LOW');
  assert.equal(t.trigger_phase, 'QUALITY');
});

test('extractMaxMindTriggers: tolerates steps with no triggers array', () => {
  const built = makeBuiltCampaign([{ id: 'step-1', name: 'converted' }]);
  assert.deepEqual(extractMaxMindTriggers(built), []);
});

// ── filterQualityRules ───────────────────────────────────────────────────────

test('filterQualityRules: returns enabled-only by default', () => {
  const rules = [
    { id: '1', enabled: true, rule_type: 'SELF_REFERRAL' },
    { id: '2', enabled: false, rule_type: 'BAD_COUNTRY' },
    { id: '3', enabled: true, rule_type: 'VALID_EMAIL' },
  ];
  const result = filterQualityRules(rules);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(r => r.id).sort(), ['1', '3']);
});

test('filterQualityRules: returns all when includeDisabled is true', () => {
  const rules = [
    { id: '1', enabled: true },
    { id: '2', enabled: false },
  ];
  assert.equal(filterQualityRules(rules, { includeDisabled: true }).length, 2);
});

test('filterQualityRules: empty / non-array input returns []', () => {
  assert.deepEqual(filterQualityRules([]), []);
  assert.deepEqual(filterQualityRules(null), []);
  assert.deepEqual(filterQualityRules(undefined), []);
});

// ── formatProperties ─────────────────────────────────────────────────────────

test('formatProperties: empty object returns "-"', () => {
  assert.equal(formatProperties({}), '-');
  assert.equal(formatProperties(null), '-');
  assert.equal(formatProperties(undefined), '-');
});

test('formatProperties: joins key=value pairs with comma', () => {
  const props = { cap_number: ['10'], lookback_interval: ['7'] };
  const result = formatProperties(props);
  assert.ok(result.includes('cap_number=10'));
  assert.ok(result.includes('lookback_interval=7'));
  assert.ok(result.includes(', '));
});

test('formatProperties: comma-joins array values within a key', () => {
  const props = { countries: ['KP', 'IR'] };
  assert.equal(formatProperties(props), 'countries=KP,IR');
});
