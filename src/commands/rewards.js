import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';

export const VALID_REWARD_STATES = new Set(['EARNED', 'FULFILLED', 'SENT', 'REDEEMED', 'CANCELED', 'FAILED', 'REVOKED', 'EXPIRED']);
const VALID_REWARD_TYPES = new Set(['MANUAL_COUPON', 'SALESFORCE_COUPON', 'TANGO_V2', 'CUSTOM_REWARD', 'PAYPAL_PAYOUTS']);
const COUPON_SUPPLIER_TYPES = new Set(['MANUAL_COUPON', 'SALESFORCE_COUPON']);
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions, isValidEmail, formatEventDate } from '../utils.js';
import { findPerson, getPersonSteps } from '../person-api.js';

export function formatReward(r) {
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
    .description('Look up, search, and inspect rewards')
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

  // ── find-coupon ────────────────────────────────────────────────────────
  // Reverse lookup: given a coupon code (partner_reward_id), find the reward
  // it was minted for. Answers "was this code used?" without needing the
  // recipient's email first.

  const findCouponCmd = new Command('find-coupon')
    .argument('<code>', 'Coupon code (partner_reward_id) — exact match')
    .description('Look up a reward by its coupon code (partner_reward_id). Answers "who got this code, and was it used?" — REDEEMED means Extole received a redemption signal; SENT means it was issued but not (yet) redeemed.')
    .allowExcessArguments(false)
    .action(async function (code) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      const params = new URLSearchParams({ partner_reward_id: code });
      const rewards = await apiJson(`/v2/rewards?${params}`, token, { verbose: opts.verbose, baseUrl: API_BASE });
      const list = Array.isArray(rewards) ? rewards : [];

      if (opts.json) {
        printJson(list, opts);
        return;
      }

      if (list.length === 0) {
        console.error(`No reward found with coupon code "${code}" in this account.`);
        process.exit(1);
      }

      const stateNote = (s) => {
        if (s === 'REDEEMED') return 'Coupon was redeemed (Extole received a redemption signal).';
        if (s === 'SENT') return 'Coupon issued but Extole has not received a redemption signal.';
        if (s === 'FULFILLED') return 'Coupon minted but not yet sent to the customer.';
        if (s === 'EARNED') return 'Earned but not yet fulfilled — supplier may not have minted the code yet.';
        if (s === 'CANCELED') return 'Reward was canceled.';
        if (s === 'EXPIRED') return 'Reward expired without redemption.';
        if (s === 'REVOKED') return 'Reward was revoked after fulfillment.';
        if (s === 'FAILED') return 'Reward failed during state transition.';
        return `State: ${s || 'unknown'}`;
      };

      console.log(`Coupon ${code}  (${list.length} match${list.length === 1 ? '' : 'es'}):\n`);
      for (const r of list) {
        const value = r.face_value != null ? `${r.face_value} ${r.face_value_type || ''}`.trim() : '';
        const created = r.created_date || r.created_at;
        console.log(`  state         ${r.state || ''}`);
        if (value) console.log(`  face_value    ${value}`);
        if (r.email) console.log(`  email         ${r.email}`);
        if (r.journey_name) console.log(`  journey       ${r.journey_name}`);
        if (r.campaign_id) console.log(`  campaign      ${r.campaign_id}`);
        if (r.reward_id || r.id) console.log(`  reward_id     ${r.reward_id || r.id}`);
        if (created) console.log(`  created_at    ${formatEventDate(created)}`);
        console.log();
        console.log(`  ${stateNote((r.state || '').toUpperCase())}`);
        const rid = r.reward_id || r.id;
        if (rid) console.log(`  For the full timeline: extole rewards history ${rid}`);
        if (list.length > 1) console.log();
      }
    });

  addGlobalOptions(findCouponCmd, {
    output: true,
    examples: [
      'extole rewards find-coupon 2BJMSZ57T1DG',
      'extole rewards find-coupon 2BJMSZ57T1DG --json',
    ],
  });

  cmd.addCommand(findCouponCmd);

  // ── list ───────────────────────────────────────────────────────────────
  // Fleet-wide reward search — no email required. Uses /v2/rewards which
  // supports filtering by state, supplier, type, and time without a person.

  const listCmd = new Command('list')
    .description('Search rewards account-wide by state, supplier, or type. No email required — use this for ops queries like "show all FAILED rewards today".')
    .allowExcessArguments(false)
    .option('--state <state>', 'Filter by state (EARNED, FULFILLED, SENT, REDEEMED, CANCELED, FAILED, REVOKED)')
    .option('--supplier <id>', 'Filter by reward supplier ID')
    .option('--reward-type <type>', 'Filter by supplier type (MANUAL_COUPON, SALESFORCE_COUPON, TANGO_V2, CUSTOM_REWARD, PAYPAL_PAYOUTS)')
    .option('--all', 'Include non-successful rewards (disables success_only filter)')
    .option('--limit <n>', 'Max rewards to return', '25')
    .action(async function () {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      const limit = parseInt(opts.limit, 10);
      if (isNaN(limit) || limit <= 0) {
        console.error('--limit must be a positive integer');
        process.exit(2);
      }

      if (opts.state && !VALID_REWARD_STATES.has(opts.state.toUpperCase())) {
        console.error(`Error: --state must be one of: ${[...VALID_REWARD_STATES].join(', ')}`);
        process.exit(2);
      }

      if (opts.rewardType && !VALID_REWARD_TYPES.has(opts.rewardType.toUpperCase())) {
        console.error(`Error: --reward-type must be one of: ${[...VALID_REWARD_TYPES].join(', ')}`);
        process.exit(2);
      }

      const params = new URLSearchParams({ limit: String(limit) });
      if (opts.state) params.set('state', opts.state.toUpperCase());
      if (opts.supplier) params.set('reward_supplier_id', opts.supplier);
      if (opts.rewardType) params.set('reward_type', opts.rewardType.toUpperCase());
      if (opts.all) params.set('success_only', 'false');

      const rewards = await apiJson(`/v2/rewards?${params}`, token, { verbose: opts.verbose, baseUrl: API_BASE });
      const list = Array.isArray(rewards) ? rewards : [];

      if (opts.json) {
        printJson(list, opts);
        return;
      }

      if (list.length === 0) {
        console.log('No rewards found matching the given filters.');
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
      for (const r of list) {
        formatReward(r);
      }
    });

  addGlobalOptions(listCmd, {
    output: true,
    examples: [
      'extole rewards list --state FAILED',
      'extole rewards list --state FAILED --all',
      'extole rewards list --supplier abc123 --state EARNED',
      'extole rewards list --reward-type TANGO_V2 --limit 50',
      'extole rewards list --state FAILED --json | jq \'.[].reward_id\'',
    ],
  });

  cmd.addCommand(listCmd);

  // ── fulfillments ───────────────────────────────────────────────────────
  // Shows per-attempt fulfillment detail including the raw supplier error
  // message — the thing history doesn't carry.

  const fulfillmentsCmd = new Command('fulfillments')
    .argument('<reward_id>', 'Reward ID')
    .description('Show fulfillment attempts for a reward — includes coupon code, cost_code, amount, and the raw supplier error message. Use this when history shows a failed fulfillment and you need the actual BHN/Tango error.')
    .allowExcessArguments(false)
    .action(async function (rewardId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      const fulfillments = await apiJson(`/v2/rewards/${rewardId}/fulfillments`, token, { verbose: opts.verbose, baseUrl: API_BASE });
      const list = Array.isArray(fulfillments) ? fulfillments : [];

      if (opts.json) {
        printJson(list, opts);
        return;
      }

      if (list.length === 0) {
        console.log(`No fulfillment attempts found for reward ${rewardId}.`);
        return;
      }

      const ordered = list.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      console.log(`Reward ${rewardId}  fulfillments (${ordered.length}):`);
      console.log();
      for (const f of ordered) {
        const ok = f.success ? '✓' : '✗';
        console.log(`  ${ok}  ${formatEventDate(f.created_at)}`);
        if (f.partner_reward_id) console.log(`     coupon_code   ${f.partner_reward_id}`);
        if (f.cost_code)         console.log(`     cost_code     ${f.cost_code}`);
        if (f.amount != null)    console.log(`     amount        ${f.amount}`);
        if (f.message)           console.log(`     message       ${f.message}`);
        console.log();
      }
    });

  addGlobalOptions(fulfillmentsCmd, {
    output: true,
    examples: [
      'extole rewards fulfillments efda6f32db286845ac9f6272',
      'extole rewards fulfillments efda6f32db286845ac9f6272 --json',
    ],
  });

  cmd.addCommand(fulfillmentsCmd);

  // ── sends ──────────────────────────────────────────────────────────────

  const sendsCmd = new Command('sends')
    .argument('<reward_id>', 'Reward ID')
    .description('Show send attempts for a reward — includes the email address it was sent to, partner send ID, and whether the send succeeded. Use this to debug "was the code actually delivered to the right address?"')
    .allowExcessArguments(false)
    .action(async function (rewardId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      const sends = await apiJson(`/v2/rewards/${rewardId}/sends`, token, { verbose: opts.verbose, baseUrl: API_BASE });
      const list = Array.isArray(sends) ? sends : [];

      if (opts.json) {
        printJson(list, opts);
        return;
      }

      if (list.length === 0) {
        console.log(`No send attempts found for reward ${rewardId}.`);
        return;
      }

      const ordered = list.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      console.log(`Reward ${rewardId}  sends (${ordered.length}):`);
      console.log();
      for (const s of ordered) {
        const ok = s.success ? '✓' : '✗';
        console.log(`  ${ok}  ${formatEventDate(s.created_at)}`);
        if (s.email)                  console.log(`     email              ${s.email}`);
        if (s.partner_reward_sent_id) console.log(`     partner_send_id    ${s.partner_reward_sent_id}`);
        if (s.message)                console.log(`     message            ${s.message}`);
        console.log();
      }
    });

  addGlobalOptions(sendsCmd, {
    output: true,
    examples: [
      'extole rewards sends efda6f32db286845ac9f6272',
      'extole rewards sends efda6f32db286845ac9f6272 --json',
    ],
  });

  cmd.addCommand(sendsCmd);

  // ── redeems ────────────────────────────────────────────────────────────

  const redeemsCmd = new Command('redeems')
    .argument('<reward_id>', 'Reward ID')
    .description('Show redemption events for a reward — includes the triggering event name, partner event ID, and cause event ID. Use this to verify what triggered the redemption signal and trace it back to the originating event.')
    .allowExcessArguments(false)
    .action(async function (rewardId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      const redeems = await apiJson(`/v2/rewards/${rewardId}/redeems`, token, { verbose: opts.verbose, baseUrl: API_BASE });
      const list = Array.isArray(redeems) ? redeems : [];

      if (opts.json) {
        printJson(list, opts);
        return;
      }

      if (list.length === 0) {
        console.log(`No redemption events found for reward ${rewardId}.`);
        return;
      }

      const ordered = list.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      console.log(`Reward ${rewardId}  redeems (${ordered.length}):`);
      console.log();
      for (const r of ordered) {
        console.log(`  ${formatEventDate(r.created_at)}`);
        if (r.event_name)               console.log(`     event_name             ${r.event_name}`);
        if (r.partner_event_id)         console.log(`     partner_event_id       ${r.partner_event_id}`);
        if (r.partner_reward_redeem_id) console.log(`     partner_redeem_id      ${r.partner_reward_redeem_id}`);
        if (r.cause_event_id)           console.log(`     cause_event_id         ${r.cause_event_id}`);
        if (r.message)                  console.log(`     message                ${r.message}`);
        console.log();
      }
    });

  addGlobalOptions(redeemsCmd, {
    output: true,
    examples: [
      'extole rewards redeems efda6f32db286845ac9f6272',
      'extole rewards redeems efda6f32db286845ac9f6272 --json',
    ],
  });

  cmd.addCommand(redeemsCmd);

  // ── cancels ────────────────────────────────────────────────────────────

  const cancelsCmd = new Command('cancels')
    .argument('<reward_id>', 'Reward ID')
    .description('Show cancellation events for a reward — includes who canceled it (operator_user_id) and why (message). Use this to answer "who canceled this reward and what was the reason?"')
    .allowExcessArguments(false)
    .action(async function (rewardId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      const cancels = await apiJson(`/v2/rewards/${rewardId}/cancels`, token, { verbose: opts.verbose, baseUrl: API_BASE });
      const list = Array.isArray(cancels) ? cancels : [];

      if (opts.json) {
        printJson(list, opts);
        return;
      }

      if (list.length === 0) {
        console.log(`No cancellation events found for reward ${rewardId}.`);
        return;
      }

      const ordered = list.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      console.log(`Reward ${rewardId}  cancels (${ordered.length}):`);
      console.log();
      for (const c of ordered) {
        console.log(`  ${formatEventDate(c.created_at)}`);
        if (c.operator_user_id) console.log(`     operator     ${c.operator_user_id}`);
        if (c.message)          console.log(`     message      ${c.message}`);
        console.log();
      }
    });

  addGlobalOptions(cancelsCmd, {
    output: true,
    examples: [
      'extole rewards cancels efda6f32db286845ac9f6272',
      'extole rewards cancels efda6f32db286845ac9f6272 --json',
    ],
  });

  cmd.addCommand(cancelsCmd);

  // ── suppliers ──────────────────────────────────────────────────────────

  const suppliersCmd = new Command('suppliers')
    .description('List reward suppliers configured on this account.')
    .allowExcessArguments(false)
    .option('--include-archived', 'Include archived suppliers')
    .action(async function () {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      const params = new URLSearchParams();
      if (opts.includeArchived) params.set('include_archived', 'true');

      const suppliers = await apiJson(`/v6/reward-suppliers?${params}`, token, { verbose: opts.verbose, baseUrl: API_BASE });
      const list = Array.isArray(suppliers) ? suppliers : [];

      if (opts.json) {
        printJson(list, opts);
        return;
      }

      if (list.length === 0) {
        console.log('No reward suppliers found.');
        return;
      }

      const trunc = (str, max) => str.length > max ? str.slice(0, max - 1) + '…' : str;

      const MAX_NAME = 40;
      const MAX_VAL  = 16;
      const typeW = Math.max('type'.length, ...list.map(s => (s.reward_supplier_type || '').length));

      console.log(
        'type'.padEnd(typeW + 2) +
        'name'.padEnd(MAX_NAME + 2) +
        'face_value'.padEnd(MAX_VAL + 2) +
        'en  ' +
        'id'
      );
      console.log(
        '─'.repeat(typeW + 2) + '─'.repeat(MAX_NAME + 2) +
        '─'.repeat(MAX_VAL + 2) + '─'.repeat(4) + '─'.repeat(24)
      );

      for (const s of list) {
        const type    = (s.reward_supplier_type || '').padEnd(typeW + 2);
        const name    = trunc(s.display_name || s.name || '', MAX_NAME).padEnd(MAX_NAME + 2);
        const rawVal  = s.face_value != null ? `${s.face_value} ${s.face_value_type || ''}`.trim() : '';
        const val     = trunc(rawVal, MAX_VAL).padEnd(MAX_VAL + 2);
        const enabled = s.enabled ? 'Y' : 'N';
        const id      = (s.id || '').slice(0, 24);
        console.log(`${type}${name}${val}  ${enabled}   ${id}`);
      }
    });

  addGlobalOptions(suppliersCmd, {
    output: true,
    examples: [
      'extole rewards suppliers',
      'extole rewards suppliers --include-archived',
      'extole rewards suppliers --json',
      'extole rewards suppliers get <supplier_id>',
    ],
  });

  // ── suppliers get ──────────────────────────────────────────────────────

  const suppliersGetCmd = new Command('get')
    .argument('<supplier_id>', 'Reward supplier ID')
    .description('Get full detail for a reward supplier. For MANUAL_COUPON and SALESFORCE_COUPON suppliers, also shows coupon inventory (available vs. issued).')
    .allowExcessArguments(false)
    .action(async function (supplierId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      const s = await apiJson(`/v6/reward-suppliers/${supplierId}`, token, { verbose: opts.verbose, baseUrl: API_BASE });

      let stats = null;
      const supplierType = (s.reward_supplier_type || '').toUpperCase();
      if (COUPON_SUPPLIER_TYPES.has(supplierType)) {
        const statsPath = supplierType === 'MANUAL_COUPON'
          ? `/v2/reward-suppliers/manual-coupons/${supplierId}/stats`
          : `/v2/reward-suppliers/salesforce-coupons/${supplierId}/stats`;
        stats = await apiJson(statsPath, token, { verbose: opts.verbose, baseUrl: API_BASE }).catch(() => null);
      }

      if (opts.json) {
        printJson(stats ? { ...s, stats } : s, opts);
        return;
      }

      const field = (label, value) => value != null && value !== ''
        ? console.log(`${label.padEnd(24)}${value}`)
        : null;

      field('id',                   s.id);
      field('name',                 s.name);
      field('display_name',         s.display_name);
      field('type',                 s.reward_supplier_type);
      field('display_type',         s.display_type);
      field('face_value',           s.face_value != null ? `${s.face_value} ${s.face_value_type || ''}`.trim() : null);
      field('face_value_algorithm', s.face_value_algorithm_type);
      field('enabled',              s.enabled != null ? String(s.enabled) : null);
      field('partner_supplier_id',  s.partner_reward_supplier_id);
      field('partner_key_type',     s.partner_reward_key_type);
      field('limit_per_day',        s.limit_per_day);
      field('limit_per_hour',       s.limit_per_hour);
      const created = s.created_date || s.created_at;
      field('created_at',           created ? formatEventDate(created) : null);

      if (stats) {
        console.log();
        console.log('Coupon inventory:');
        console.log(`  ${'available'.padEnd(12)}${stats.number_of_available_coupons ?? '—'}`);
        console.log(`  ${'issued'.padEnd(12)}${stats.number_of_issued_coupons ?? '—'}`);
      }
    });

  addGlobalOptions(suppliersGetCmd, {
    output: true,
    examples: [
      'extole rewards suppliers get abc123def456',
      'extole rewards suppliers get abc123def456 --json',
    ],
  });

  cmd._mcpDescription = 'List rewards for a person by email. Returns reward_id, state (EARNED/FULFILLED/SENT/REDEEMED/CANCELED/FAILED), face value, journey, and created date. Use --status to filter. Feed reward_id into rewards_get for full detail or rewards_history to debug a stuck reward.';
  getCmd._mcpDescription = 'Get full detail for a single reward by reward_id. Returns coupon code (partner_reward_id), reward supplier, campaign, face value, all state metadata, and optionally the recipient\'s step history (--steps). Use when a customer asks "what coupon code did I get?" or to confirm fulfillment details.';
  historyCmd._mcpDescription = 'Show the state-transition timeline for a reward — EARNED → FULFILLED → SENT → REDEEMED. Each row shows when the state changed and whether it succeeded. The definitive answer for "why is this reward stuck?" — the failure reason appears on the failed transition row.';
  stateSummaryCmd._mcpDescription = 'Account-wide reward counts bucketed by state over time. Use for ops questions: "how many EARNED rewards are sitting un-fulfilled?", "did fulfillment spike this week?". Returns aggregate counts plus a per-week breakdown across all reward states.';
  findCouponCmd._mcpDescription = 'Reverse lookup by coupon code: returns who received it, what state it\'s in, and whether Extole has been told it was redeemed. Use when you have a code and need to know if it was issued and to whom.';

  suppliersCmd.addCommand(suppliersGetCmd);
  cmd.addCommand(suppliersCmd);

  return cmd;
}
