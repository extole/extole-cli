import { Command } from 'commander';
import { resolveToken, PERSON_BASE } from '../config.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_POLL_ERRORS = 10;
const SEEN_MAX_SIZE = 5000;
const SEEN_KEEP_SIZE = 4000;

async function personApiFetch(path, token) {
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

  const getCmd = new Command('get')
    .description('Look up a person by email')
    .allowExcessArguments(false)
    .requiredOption('--email <email>', 'Email address to look up')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const match = await findPerson(opts.email, token);
      if (!match) {
        console.error(`No person found for ${opts.email}`);
        process.exit(1);
      }
      const profile = await personApiFetch(`/v4/persons/${match.id}`, token);
      printJson(profile, opts);
    });

  addGlobalOptions(getCmd, {
    output: true,
    examples: [
      'extole person get --email jane@example.com',
      'extole person get --email jane@example.com --compact',
    ],
  });

  const stepsCmd = new Command('steps')
    .description('Show steps for a person; --watch to tail live')
    .allowExcessArguments(false)
    .requiredOption('--email <email>', 'Email address to look up')
    .option('--limit <n>', 'Number of steps to return (one-shot)', '25')
    .option('--watch', 'Poll for new steps until Ctrl+C')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const match = await findPerson(opts.email, token);
      if (!match) {
        console.error(`No person found for ${opts.email}`);
        process.exit(1);
      }
      const personId = match.id;

      if (!opts.watch) {
        const limit = parseInt(opts.limit, 10);
        if (isNaN(limit) || limit <= 0) {
          console.error('--limit must be a positive integer');
          process.exit(2);
        }
        const steps = await personApiFetch(`/v5/persons/${personId}/steps?limit=${limit}`, token);
        printJson(steps, opts);
        return;
      }

      const seen = new Set();
      let errorCount = 0;
      if (!opts.json) console.error(`Watching steps for ${opts.email} — Ctrl+C to stop\n`);

      async function poll() {
        try {
          const steps = await personApiFetch(`/v5/persons/${personId}/steps?limit=50`, token);
          errorCount = 0;
          for (const step of steps.reverse()) {
            if (!seen.has(step.id)) {
              seen.add(step.id);
              if (seen.size > SEEN_MAX_SIZE) {
                const arr = [...seen];
                seen.clear();
                arr.slice(-SEEN_KEEP_SIZE).forEach(id => seen.add(id));
              }
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
          if (++errorCount >= MAX_POLL_ERRORS) {
            console.error('Too many consecutive poll errors, stopping.');
            process.exit(1);
          }
        }
      }

      await poll();
      setInterval(poll, 2500);
    });

  addGlobalOptions(stepsCmd, {
    output: true,
    examples: [
      'extole person steps --email jane@example.com',
      'extole person steps --email jane@example.com --watch',
    ],
  });

  person.addCommand(getCmd);
  person.addCommand(stepsCmd);
  return person;
}
