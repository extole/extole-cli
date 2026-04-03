import { Command } from 'commander';
import { resolveToken, PERSON_BASE } from '../config.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';

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
    ? `${r.face_value} ${r.face_value_type || ''}`.trim().padEnd(14)
    : ''.padEnd(14);
  const journey  = (r.journey_name || '').padEnd(16);
  const date     = r.created_at ? new Date(r.created_at).toLocaleDateString('en-US') : '';
  const id       = (r.reward_id || '').slice(0, 24);
  console.log(`${state}${value}${journey}${date.padEnd(12)}${id}`);
}

export function rewardsCommand() {
  const cmd = new Command('rewards')
    .description('Look up reward state for a person by email')
    .requiredOption('--email <email>', 'Email address to look up')
    .option('--status <state>', 'Filter by state (EARNED, FULFILLED, SENT, REDEEMED, CANCELED, FAILED, EXPIRED)')
    .option('--limit <n>', 'Max rewards to return', '25')
    .action(async (opts) => {
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

      const col = { state: 12, value: 14, journey: 16, date: 12 };
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

  return addGlobalOptions(cmd, {
    output: true,
    examples: [
      'extole rewards --email jane@example.com',
      'extole rewards --email jane@example.com --status EARNED',
      'extole rewards --email jane@example.com --json | jq \'.[].reward_id\'',
    ],
  });
}
