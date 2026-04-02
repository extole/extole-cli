import { Command } from 'commander';
import { resolveToken } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';

const PERSON_BASE = 'https://api.extole.io';

async function personApiFetch(path, token) {
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(`${PERSON_BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`API error ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function findPerson(email, token) {
  const results = await personApiFetch(`/v5/persons?identity_key_value=${encodeURIComponent(email)}&limit=1`, token);
  if (!results || results.length === 0) return null;
  return results[0];
}

export function personCommand() {
  const person = new Command('person');

  person
    .command('get')
    .description('Look up a person by email')
    .requiredOption('--email <email>', 'Email address to look up')
    .option('--compact', 'Strip nulls and empty fields')
    .option('--token <token>', 'Override token')
    .option('--profile <profile>', 'Profile name', 'default')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const match = await findPerson(opts.email, token);
      if (!match) {
        console.error(`No person found for ${opts.email}`);
        process.exit(1);
      }
      // Fetch richer v4 profile
      const profile = await personApiFetch(`/v4/persons/${match.id}`, token);
      printJson(profile, opts);
    });

  person
    .command('steps')
    .description('Show steps for a person')
    .requiredOption('--email <email>', 'Email address to look up')
    .option('--limit <n>', 'Number of steps to return', '25')
    .option('--compact', 'Strip nulls and empty fields')
    .option('--token <token>', 'Override token')
    .option('--profile <profile>', 'Profile name', 'default')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const match = await findPerson(opts.email, token);
      if (!match) {
        console.error(`No person found for ${opts.email}`);
        process.exit(1);
      }
      const steps = await personApiFetch(`/v5/persons/${match.id}/steps?limit=${opts.limit}`, token);
      printJson(steps, opts);
    });

  return person;
}
