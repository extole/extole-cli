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

export async function findPerson(email, token) {
  const results = await personApiFetch(`/v5/persons?identity_key_value=${encodeURIComponent(email)}&limit=1`, token);
  if (!results || results.length === 0) return null;
  return results[0];
}

export async function getPersonSteps(personId, token, limit = 50) {
  return personApiFetch(`/v5/persons/${personId}/steps?limit=${limit}`, token);
}

export function personCommand() {
  const person = new Command('person').description('Look up person profile and step history');

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
    .description('Show steps for a person; --watch to tail live')
    .requiredOption('--email <email>', 'Email address to look up')
    .option('--limit <n>', 'Number of steps to return (one-shot)', '25')
    .option('--watch', 'Poll for new steps until Ctrl+C')
    .option('--compact', 'Strip nulls and empty fields')
    .option('--json', 'Emit one JSON object per line (with --watch)')
    .option('--token <token>', 'Override token')
    .option('--profile <profile>', 'Profile name', 'default')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const match = await findPerson(opts.email, token);
      if (!match) {
        console.error(`No person found for ${opts.email}`);
        process.exit(1);
      }
      const personId = match.id;

      if (!opts.watch) {
        const steps = await personApiFetch(`/v5/persons/${personId}/steps?limit=${opts.limit}`, token);
        printJson(steps, opts);
        return;
      }

      // Watch mode — poll for new steps
      const seen = new Set();
      if (!opts.json) console.error(`Watching steps for ${opts.email} — Ctrl+C to stop\n`);

      async function poll() {
        try {
          const steps = await personApiFetch(`/v5/persons/${personId}/steps?limit=50`, token);
          for (const step of steps.reverse()) {
            if (!seen.has(step.id)) {
              seen.add(step.id);
              if (opts.json) {
                printJson(step, opts);
              } else {
                const time = new Date(step.event_date || step.created_date)
                  .toLocaleTimeString('en-US', { hour12: false });
                const name = (step.name || '').padEnd(35);
                const program = step.program || '';
                console.log(`${time}  ${name}  ${program}`);
              }
            }
          }
        } catch (e) {
          console.error(`poll error: ${e.message}`);
        }
      }

      await poll();
      setInterval(poll, 2500);
    });

  return person;
}
