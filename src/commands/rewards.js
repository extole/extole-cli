import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';

const VALID_REWARD_STATES = new Set(['EARNED', 'FULFILLED', 'SENT', 'REDEEMED', 'CANCELED', 'FAILED', 'EXPIRED']);
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions, isValidEmail, formatEventDate } from '../utils.js';
import { findPerson, getPersonSteps } from '../person-api.js';

function formatReward(r) {
  const state    = (r.state || '').padEnd(12);
  const value    = r.face_value != null
    ? `${r.face_value} ${r.face_value_type || ''}`.trim().padEnd(18)
    : ''.padEnd(18);
  const journey  = (r.journey_name || '').padEnd(16);
  const dateVal  = r.created_date || r.created_at;
  const date     = dateVal ? new Date(dateVal).toLocaleDateString('en-US') : '';
  const id       = (r.id || r.reward_id || '').slice(0, 24);
  console.log(`${state}${value}${journey}${date.padEnd(12)}${id}`);
}

export function rewardsCommand() {
  const cmd = new Command('rewards')
    .description('Look up rewards by email or reward ID')
    .allowExcessArguments(false)
    .option('--email <email>', 'Email address to look up')
    .option('--status <state>', 'Filter by state (EARNED, FULFILLED, SENT, REDEEMED, CANCELED, FAILED, EXPIRED)')
    .option('--limit <n>', 'Max rewards to return', '25')
    .action(async (opts) => {
      if (!opts.email) {
        console.error('Error: --email <email> is required.');
        process.exit(2);
      }
      if (!isValidEmail(opts.email)) {
        console.error('Error: --email must be a valid email address.');
        process.exit(2);
      }
      const token = resolveToken(opts);

      const limit = parseInt(opts.limit, 10);
      if (isNaN(limit) || limit <= 0) {
        console.error('--limit must be a positive integer');
        process.exit(2);
      }

      if (opts.status && !VALID_REWARD_STATES.has(opts.status.toUpperCase())) {
        console.error(`Error: --status must be one of: ${[...VALID_REWARD_STATES].join(', ')}`);
        process.exit(2);
      }

      const match = await findPerson(opts.email, token, opts.verbose);
      if (!match) {
        console.error(`No person found for ${opts.email}`);
        process.exit(1);
      }

      const params = new URLSearchParams({ limit: String(limit) });
      if (opts.status) params.set('state', opts.status.toUpperCase());

      const rewards = await apiJson(`/v5/persons/${match.id}/rewards?${params}`, token, { verbose: opts.verbose, baseUrl: API_BASE });

      if (!Array.isArray(rewards) || rewards.length === 0) {
        const suffix = opts.status ? ` with state=${opts.status.toUpperCase()}` : '';
        console.error(`No rewards found for ${opts.email} (person ID: ${match.id})${suffix}`);
        return;
      }

      if (opts.json) {
        printJson(rewards, opts);
        return;
      }

      const col = { state: 12, value: 18, journey: 16, date: 12 };
      console.log(
        'state'.padEnd(col.state) +
        'face_value'.padEnd(col.value) +
        'journey'.padEnd(col.journey) +
        'created_at'.padEnd(col.date) +
        'reward_id'
      );
      console.log('─'.repeat(col.state) + '─'.repeat(col.value) + '─'.repeat(col.journey) + '─'.repeat(col.date) + '─'.repeat(24));
      for (const r of rewards) {
        formatReward(r);
      }
    });

  addGlobalOptions(cmd, {
    output: true,
    examples: [
      'extole rewards --email jane@example.com',
      'extole rewards --email jane@example.com --status EARNED',
      'extole rewards --email jane@example.com --json | jq \'.[].reward_id\'',
      'extole rewards get <reward_id>',
    ],
  });

  const getCmd = new Command('get')
    .argument('<reward_id>', 'Reward ID to look up')
    .description('Show full detail for a single reward')
    .allowExcessArguments(false)
    .option('--steps', 'Also show step history for the reward recipient')
    .action(async function(rewardId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      const r = await apiJson(`/v2/rewards/${rewardId}`, token, { verbose: opts.verbose, baseUrl: API_BASE });

      if (opts.json) {
        if (opts.steps && r.person_id) {
          const steps = await getPersonSteps(r.person_id, token, 50, opts.verbose);
          printJson({ reward: r, steps }, opts);
        } else {
          printJson(r, opts);
        }
        return;
      }

      const field = (label, value) => value != null && value !== ''
        ? console.log(`${label.padEnd(22)}${value}`)
        : null;

      field('reward_id',       r.id || r.reward_id);
      field('state',           r.state);
      field('face_value',      r.face_value != null ? `${r.face_value} ${r.face_value_type || ''}`.trim() : null);
      field('coupon_code',     r.partner_reward_id);
      field('journey',         r.journey_name);
      field('rewardee_role',   r.data?.rewardee_role);
      field('person_id',       r.person_id);
      field('email',           r.email);
      field('campaign_id',     r.campaign_id);
      field('cause_event_id',  r.cause_event_id);
      const createdDate = r.created_date || r.created_at;
      field('created_at',      createdDate ? formatEventDate(createdDate) : null);
      field('container',       r.container);

      if (opts.steps && r.person_id) {
        const rewardDate = r.created_at ? new Date(r.created_at) : null;
        const steps = await getPersonSteps(r.person_id, token, 50, opts.verbose);
        const stepList = Array.isArray(steps) ? steps : [];
        console.log('\nSteps:');
        console.log('─'.repeat(70));
        for (const s of stepList) {
          const stepDate = new Date(s.event_date || s.created_date);
          const age = rewardDate ? Math.round((rewardDate - stepDate) / (1000 * 60 * 60 * 24)) : null;
          const dateStr = formatEventDate(stepDate.toISOString()).padEnd(22);
          const rel = age !== null ? (age === 0 ? '(same day)' : age > 0 ? `(${age}d before)` : `(${Math.abs(age)}d after)`).padEnd(14) : ''.padEnd(14);
          const name = (s.name || '').padEnd(35);
          console.log(`${dateStr}${rel}${name}${s.journey_name || ''}`);
        }
      }
    });

  addGlobalOptions(getCmd, {
    output: true,
    examples: [
      'extole rewards get efda6f32db286845ac9f6272',
      'extole rewards get efda6f32db286845ac9f6272 --account my-client',
      'extole rewards get efda6f32db286845ac9f6272 --json',
    ],
  });

  cmd.addCommand(getCmd);

  // ── history ────────────────────────────────────────────────────────────

  const historyCmd = new Command('history')
    .argument('<reward_id>', 'Reward ID to look up')
    .description('Show the state-transition history for a reward (EARNED → FULFILLED → SENT → REDEEMED, etc.). Use this to debug "why is this reward stuck?" — each row shows when the state changed and whether the transition succeeded.')
    .allowExcessArguments(false)
    .action(async function (rewardId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      const history = await apiJson(`/v2/rewards/${rewardId}/history`, token, { verbose: opts.verbose, baseUrl: API_BASE });

      if (opts.json) {
        printJson(history, opts);
        return;
      }
      if (!Array.isArray(history) || history.length === 0) {
        console.log(`No history found for reward ${rewardId}.`);
        return;
      }

      // Render oldest-first so the timeline reads top-to-bottom
      const ordered = history.slice().sort((a, b) =>
        new Date(a.created_at) - new Date(b.created_at)
      );

      console.log(`Reward ${rewardId}  history (${ordered.length} state transition${ordered.length === 1 ? '' : 's'}):`);
      console.log();
      const stateW = Math.max('state'.length, ...ordered.map(h => (h.state_type || '').length));
      console.log(`${'state'.padEnd(stateW)}  ok    when                       message`);
      console.log(`${'─'.repeat(stateW)}  ────  ─────────────────────────  ${'─'.repeat(30)}`);
      for (const h of ordered) {
        const state = (h.state_type || '').padEnd(stateW);
        const ok = h.success ? ' ✓  ' : ' ✗  ';
        const when = formatEventDate(h.created_at).padEnd(25);
        const msg = h.message || '';
        console.log(`${state}  ${ok}  ${when}  ${msg}`);
      }
    });

  addGlobalOptions(historyCmd, {
    output: true,
    examples: [
      'extole rewards history efda6f32db286845ac9f6272',
      'extole rewards history efda6f32db286845ac9f6272 --json',
    ],
  });

  cmd.addCommand(historyCmd);

  // ── state-summary ──────────────────────────────────────────────────────

  const stateSummaryCmd = new Command('state-summary')
    .description('Account-wide reward counts bucketed by state (EARNED / FULFILLED / SENT / REDEEMED / CANCELED / FAILED / REVOKED) over time. Useful for ops questions like "how many EARNED rewards are sitting un-fulfilled?"')
    .allowExcessArguments(false)
    .action(async function () {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      const data = await apiJson('/v2/rewards/state_summary', token, { verbose: opts.verbose, baseUrl: API_BASE });
      const rows = Array.isArray(data) ? data : [];

      if (opts.json) {
        printJson(rows, opts);
        return;
      }
      if (rows.length === 0) {
        console.log('No reward state data on this account.');
        return;
      }

      // Aggregate totals across the whole window
      const totals = rows.reduce((acc, r) => {
        for (const k of ['earned', 'fulfilled', 'sent', 'redeemed', 'canceled', 'failed', 'revoked']) {
          acc[k] = (acc[k] || 0) + (r[k] || 0);
        }
        return acc;
      }, {});

      console.log('Reward state totals (across all buckets):');
      const stateNames = ['earned', 'fulfilled', 'sent', 'redeemed', 'canceled', 'failed', 'revoked'];
      const labelW = Math.max(...stateNames.map(s => s.length));
      for (const k of stateNames) {
        console.log(`  ${k.padEnd(labelW)}  ${totals[k] || 0}`);
      }

      console.log();
      console.log(`By date bucket (${rows.length} bucket${rows.length === 1 ? '' : 's'}):`);
      console.log(`${'from'.padEnd(12)}  ${'to'.padEnd(12)}  earn  fulf  sent  redm  canc  fail  revo`);
      console.log(`${'─'.repeat(12)}  ${'─'.repeat(12)}  ${'────  '.repeat(7).trim()}`);
      for (const r of rows) {
        const from = (r.date_from || '').slice(0, 10).padEnd(12);
        const to = (r.date_to || '').slice(0, 10).padEnd(12);
        const fmt = (n) => String(n || 0).padStart(4);
        console.log(`${from}  ${to}  ${fmt(r.earned)}  ${fmt(r.fulfilled)}  ${fmt(r.sent)}  ${fmt(r.redeemed)}  ${fmt(r.canceled)}  ${fmt(r.failed)}  ${fmt(r.revoked)}`);
      }
    });

  addGlobalOptions(stateSummaryCmd, {
    output: true,
    examples: [
      'extole rewards state-summary',
      'extole rewards state-summary --json',
    ],
  });

  cmd.addCommand(stateSummaryCmd);

  return cmd;
}
