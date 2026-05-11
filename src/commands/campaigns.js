import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';

const EXPECTED_MAXMIND_THRESHOLD = 20;

async function fetchQualityRules(campaignId, token, verbose) {
  return apiJson(
    `/v2/campaigns/${campaignId}/incentive/quality-rules`,
    token,
    { verbose, baseUrl: API_BASE },
  );
}

async function fetchBuiltCampaign(campaignId, token, verbose) {
  return apiJson(
    `/v2/campaigns/${campaignId}/built`,
    token,
    { verbose, baseUrl: API_BASE },
  );
}

export function extractMaxMindTriggers(built, { includeDisabled = false } = {}) {
  const out = [];
  for (const step of (built?.steps || [])) {
    for (const t of (step?.triggers || [])) {
      if (t.trigger_type !== 'MAXMIND') continue;
      if (!includeDisabled && t.enabled === false) continue;
      out.push({
        step_id: step.id,
        step_name: step.name,
        trigger_id: t.trigger_id,
        trigger_name: t.trigger_name,
        trigger_phase: t.trigger_phase,
        enabled: t.enabled,
        risk_threshold: t.risk_threshold,
        ip_threshold: t.ip_threshold,
        allow_high_risk_email: t.allow_high_risk_email,
        default_quality_score: t.default_quality_score,
      });
    }
  }
  return out;
}

export function filterQualityRules(rules, { includeDisabled = false } = {}) {
  if (!Array.isArray(rules)) return [];
  return includeDisabled ? rules : rules.filter(r => r.enabled);
}

export function formatProperties(properties) {
  if (!properties || typeof properties !== 'object') return '-';
  const keys = Object.keys(properties);
  if (keys.length === 0) return '-';
  const parts = [];
  for (const k of keys) {
    const v = properties[k];
    const joined = Array.isArray(v) ? v.join(',') : String(v);
    parts.push(`${k}=${joined}`);
  }
  return parts.join(', ');
}

function qualityRulesCommand() {
  const cmd = new Command('quality-rules')
    .description('Show quality rules configured for a campaign')
    .allowExcessArguments(false)
    .argument('<campaign-id>', 'Campaign ID')
    .option('--include-disabled', 'Include disabled quality rules (default: only enabled)')
    .action(async function (campaignId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const raw = await fetchQualityRules(campaignId, token, opts.verbose);
      const all = Array.isArray(raw) ? raw : [];
      const rules = filterQualityRules(all, { includeDisabled: opts.includeDisabled });

      if (opts.json) {
        printJson(rules, opts);
        return;
      }

      if (all.length === 0) {
        console.log('No quality rules configured.');
        return;
      }

      if (rules.length === 0) {
        console.log(`No enabled quality rules. ${all.length} disabled — pass --include-disabled to see them.`);
        return;
      }

      const rows = rules.map(r => ({
        rule_type: r.rule_type || '',
        enabled: r.enabled ? 'on' : 'off',
        action_types: Array.from(r.action_types || []).sort().join(','),
        properties: formatProperties(r.properties),
      }));

      const typeW = Math.max('rule_type'.length, ...rows.map(r => r.rule_type.length));
      const enabledW = Math.max('enabled'.length, ...rows.map(r => r.enabled.length));
      const actionsW = Math.max('action_types'.length, ...rows.map(r => r.action_types.length));

      const line = (a, b, c, d) =>
        `${a.padEnd(typeW)}  ${b.padEnd(enabledW)}  ${c.padEnd(actionsW)}  ${d}`;

      console.log(`campaign ${campaignId}`);
      console.log();
      console.log(line('rule_type', 'enabled', 'action_types', 'properties'));
      console.log(`${'─'.repeat(typeW)}  ${'─'.repeat(enabledW)}  ${'─'.repeat(actionsW)}  ${'─'.repeat(10)}`);
      for (const r of rows) {
        console.log(line(r.rule_type, r.enabled, r.action_types, r.properties));
      }

      const enabledCount = all.filter(r => r.enabled).length;
      const disabledCount = all.length - enabledCount;
      console.log();
      console.log(`${all.length} rules (${enabledCount} enabled, ${disabledCount} disabled)`);
    });

  return addGlobalOptions(cmd, {
    output: true,
    examples: [
      'extole campaigns quality-rules 7561849656158225249',
      'extole campaigns quality-rules 7561849656158225249 --include-disabled',
      'extole campaigns quality-rules 7561849656158225249 --json',
    ],
  });
}

function maxmindCommand() {
  const cmd = new Command('maxmind')
    .description('Show MaxMind controller-trigger settings for a campaign')
    .allowExcessArguments(false)
    .argument('<campaign-id>', 'Campaign ID')
    .option('--include-disabled', 'Include disabled MaxMind triggers (default: only enabled)')
    .action(async function (campaignId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const built = await fetchBuiltCampaign(campaignId, token, opts.verbose);
      const triggers = extractMaxMindTriggers(built, { includeDisabled: opts.includeDisabled });
      const allTriggers = extractMaxMindTriggers(built, { includeDisabled: true });

      if (opts.json) {
        printJson(triggers, opts);
        return;
      }

      if (allTriggers.length === 0) {
        console.log('No MaxMind triggers configured for this campaign.');
        return;
      }

      if (triggers.length === 0) {
        console.log(`No enabled MaxMind triggers. ${allTriggers.length} disabled — pass --include-disabled to see them.`);
        return;
      }

      const stepW = Math.max('step'.length, ...triggers.map(t => (t.step_name || '').length));
      const trigW = Math.max('trigger'.length, ...triggers.map(t => (t.trigger_name || '').length));
      const phaseW = Math.max('phase'.length, ...triggers.map(t => (t.trigger_phase || '').length));

      const line = (s, t, e, ph, r, ip, allow, dqs) =>
        `${s.padEnd(stepW)}  ${t.padEnd(trigW)}  ${e.padEnd(7)}  ${ph.padEnd(phaseW)}  ${r.padStart(4)}  ${ip.padStart(3)}  ${allow.padEnd(21)}  ${dqs}`;

      console.log(`campaign ${campaignId}`);
      console.log();
      console.log(line('step', 'trigger', 'enabled', 'phase', 'risk', 'ip', 'allow_high_risk_email', 'default_quality_score'));
      console.log(
        `${'─'.repeat(stepW)}  ${'─'.repeat(trigW)}  ${'─'.repeat(7)}  ${'─'.repeat(phaseW)}  ${'─'.repeat(4)}  ${'─'.repeat(3)}  ${'─'.repeat(21)}  ${'─'.repeat(21)}`,
      );
      for (const t of triggers) {
        console.log(line(
          t.step_name || '',
          t.trigger_name || '',
          t.enabled ? 'on' : 'off',
          t.trigger_phase || '',
          String(t.risk_threshold ?? ''),
          String(t.ip_threshold ?? ''),
          String(t.allow_high_risk_email ?? ''),
          String(t.default_quality_score ?? ''),
        ));
      }

      const enabledCount = triggers.length;
      const disabledCount = allTriggers.length - enabledCount;
      console.log();
      console.log(`${allTriggers.length} MaxMind trigger${allTriggers.length === 1 ? '' : 's'} (${enabledCount} enabled${disabledCount ? `, ${disabledCount} disabled` : ''}).`);

      const stale = triggers.filter(t =>
        (t.risk_threshold != null && t.risk_threshold !== EXPECTED_MAXMIND_THRESHOLD) ||
        (t.ip_threshold != null && t.ip_threshold !== EXPECTED_MAXMIND_THRESHOLD)
      );
      if (stale.length > 0) {
        process.stderr.write(
          `\nAdvisory: ${stale.length} enabled trigger${stale.length === 1 ? ' has' : 's have'} ` +
          `risk_threshold or ip_threshold != ${EXPECTED_MAXMIND_THRESHOLD}. ` +
          `The recommended value is ${EXPECTED_MAXMIND_THRESHOLD}; the legacy default was 5.\n`,
        );
      }
    });

  return addGlobalOptions(cmd, {
    output: true,
    examples: [
      'extole campaigns maxmind 7561849656158225249',
      'extole campaigns maxmind 7561849656158225249 --include-disabled',
      'extole campaigns maxmind 7561849656158225249 --json',
    ],
  });
}

export function campaignsCommand() {
  const cmd = new Command('campaigns')
    .description('Inspect per-campaign configuration (quality rules, MaxMind settings)');

  cmd.addCommand(qualityRulesCommand());
  cmd.addCommand(maxmindCommand());

  return cmd;
}
