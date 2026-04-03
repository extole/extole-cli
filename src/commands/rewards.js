import { Command } from 'commander';
import { resolveToken, PERSON_BASE } from '../config.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';
import { getPersonSteps } from './person.js';

const REQUEST_TIMEOUT_MS = 30_000;

async function rewardsFetch(path, token) {
  const { default: fetch } = await import('node-fetch');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${PERSON_BASE}${path}`, {
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`API error ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
}

function formatReward(r) {
  const state    = (r.state || '').padEnd(12);
  const value    = r.face_value != null
    ? `${r.face_value} ${r.face_value_type || ''}`.trim().padEnd(18)
    : ''.padEnd(18);
  const journey  = (r.journey_name || '').padEnd(16);
  const date     = r.created_at ? new Date(r.created_at).toLocaleDateString('en-US') : '';
  const id       = (r.reward_id || '').slice(0, 24);
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
      const token = resolveToken(opts);

      const limit = parseInt(opts.limit, 10);
      if (isNaN(limit) || limit <= 0) {
        console.error('--limit must be a positive integer');
        process.exit(2);
      }

      const params = new URLSearchParams({ email: opts.email, limit: String(limit) });
      if (opts.status) params.set('state', opts.status.toUpperCase());

      const rewards = await rewardsFetch(`/v2/rewards?${params}`, token);

      if (!Array.isArray(rewards) || rewards.length === 0) {
        console.error(`No rewards found for ${opts.email}`);
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

      const r = await rewardsFetch(`/v2/rewards/${rewardId}`, token);

      if (opts.json) {
        if (opts.steps && r.person_id) {
          const steps = await getPersonSteps(r.person_id, token);
          printJson({ reward: r, steps }, opts);
        } else {
          printJson(r, opts);
        }
        return;
      }

      const field = (label, value) => value != null && value !== ''
        ? console.log(`${label.padEnd(22)}${value}`)
        : null;

      field('reward_id',       r.reward_id);
      field('state',           r.state);
      field('face_value',      r.face_value != null ? `${r.face_value} ${r.face_value_type || ''}`.trim() : null);
      field('coupon_code',     r.partner_reward_id);
      field('journey',         r.journey_name);
      field('rewardee_role',   r.data?.rewardee_role);
      field('person_id',       r.person_id);
      field('email',           r.email);
      field('campaign_id',     r.campaign_id);
      field('cause_event_id',  r.cause_event_id);
      field('created_at',      r.created_at ? new Date(r.created_at).toLocaleString('en-US') : null);
      field('container',       r.container);

      if (opts.steps && r.person_id) {
        const rewardDate = r.created_at ? new Date(r.created_at) : null;
        const steps = await getPersonSteps(r.person_id, token);
        console.log('\nSteps:');
        console.log('─'.repeat(70));
        for (const s of steps) {
          const stepDate = new Date(s.event_date || s.created_date);
          const age = rewardDate ? Math.round((rewardDate - stepDate) / (1000 * 60 * 60 * 24)) : null;
          const dateStr = stepDate.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).padEnd(22);
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
  return cmd;
}
