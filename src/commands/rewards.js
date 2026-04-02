import { Command } from 'commander';
import { resolveToken, PLURIBUS_BASE } from '../config.js';
import { printJson } from '../output.js';
import { findPerson } from './person.js';

const REQUEST_TIMEOUT_MS = 30_000;

async function rewardsFetch(path, token) {
  const { default: fetch } = await import('node-fetch');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${PLURIBUS_BASE}${path}`, {
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

  // 204 = valid endpoint, no rewards
  if (res.status === 204) return [];

  const text = await res.text();
  if (!res.ok) throw new Error(`API error ${res.status}: ${text.slice(0, 300)}`);
  if (!text) return [];
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
}

function formatReward(r) {
  const state     = (r.state || '').padEnd(18);
  const supplier  = (r.reward_supplier_name || r.reward_supplier_id || '').padEnd(28);
  const value     = r.face_value != null
    ? `${r.face_value} ${r.face_value_type || ''}`.trim().padEnd(16)
    : ''.padEnd(16);
  const date      = r.date_earned || r.created_date || r.created_at || '';
  const dateStr   = date ? new Date(date).toLocaleDateString('en-US') : '';
  console.log(`${state}${supplier}${value}${dateStr}`);
}

export function rewardsCommand() {
  const rewards = new Command('rewards').description('Look up reward state for a person');

  rewards
    .command('get')
    .description('Show rewards for a person by email')
    .requiredOption('--email <email>', 'Email address to look up')
    .option('--status <state>', 'Filter by state (e.g. EARNED, FULFILLED, CANCELED, EXPIRED)')
    .option('--limit <n>', 'Max rewards to return', '25')
    .option('--json', 'Emit raw JSON')
    .option('--compact', 'Strip nulls and empty fields')
    .option('--token <token>', 'Override token')
    .option('--profile <profile>', 'Profile name', 'default')
    .action(async (opts) => {
      const token = resolveToken(opts);

      const limit = parseInt(opts.limit, 10);
      if (isNaN(limit) || limit <= 0) {
        console.error('--limit must be a positive integer');
        process.exit(2);
      }

      const match = await findPerson(opts.email, token);
      if (!match) {
        console.error(`No person found for ${opts.email}`);
        process.exit(1);
      }

      let rewards = await rewardsFetch(`/v4/persons/${match.id}/rewards?limit=${limit}`, token);

      if (!Array.isArray(rewards)) rewards = [rewards];

      if (opts.status) {
        const filter = opts.status.toUpperCase();
        rewards = rewards.filter(r => (r.state || '').toUpperCase() === filter);
      }

      if (rewards.length === 0) {
        console.error(`No rewards found for ${opts.email}`);
        return;
      }

      if (opts.json) {
        printJson(rewards, opts);
        return;
      }

      const col = { state: 18, supplier: 28, value: 16 };
      console.log(
        'state'.padEnd(col.state) +
        'reward_supplier'.padEnd(col.supplier) +
        'face_value'.padEnd(col.value) +
        'date_earned'
      );
      console.log('─'.repeat(col.state) + '─'.repeat(col.supplier) + '─'.repeat(col.value) + '─'.repeat(12));
      for (const r of rewards) {
        formatReward(r);
      }
    });

  return rewards;
}
