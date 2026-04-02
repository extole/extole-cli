import { Command } from 'commander';
import { resolveToken } from '../config.js';
import { apiJson, apiFetch } from '../api.js';
import { printJson } from '../output.js';

const PERSON_BASE = 'https://api.extole.io';

async function findPersonId(email, token) {
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(`${PERSON_BASE}/v5/persons?identity_key_value=${encodeURIComponent(email)}&limit=1`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  });
  const data = await res.json();
  return Array.isArray(data) && data.length > 0 ? data[0].id : null;
}

async function getPersonSteps(personId, token, limit = 50) {
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(`${PERSON_BASE}/v5/persons/${personId}/steps?limit=${limit}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  });
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function formatEvent(ev, opts) {
  if (opts.json) {
    printJson(ev, opts);
    return;
  }
  const time = new Date(ev.event_date || ev.event_time || ev.created_at || Date.now())
    .toLocaleTimeString('en-US', { hour12: false });
  const name = (ev.name || ev.event_name || '').padEnd(35);
  const program = (ev.program || '').padEnd(20);
  console.log(`${time}  ${name}  ${program}`);
}

export function eventsCommand() {
  const events = new Command('events');

  events
    .command('steps')
    .description('Tail live steps for a person (polls every 2.5s)')
    .requiredOption('--email <email>', 'Person to watch')
    .option('--filter <event_name>', 'Only show steps matching this name')
    .option('--since <duration>', 'Start window (e.g. 10m, 1h)', '10m')
    .option('--json', 'Emit one JSON object per line')
    .option('--compact', 'Strip nulls and empty fields from JSON output')
    .option('--token <token>', 'Override token')
    .option('--profile <profile>', 'Profile name', 'default')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const sinceMs = parseDuration(opts.since);
      const sinceDate = sinceMs ? new Date(Date.now() - sinceMs) : new Date(opts.since);

      const personId = await findPersonId(opts.email, token);
      if (!personId) {
        console.error(`No person found for ${opts.email}`);
        process.exit(1);
      }

      if (!opts.json) console.error(`Streaming events for ${opts.email} since ${sinceDate.toISOString()} — Ctrl+C to stop`);

      const seen = new Set();

      async function poll() {
        try {
          const steps = await getPersonSteps(personId, token, 50);
          const matching = steps.filter(s => {
            if (seen.has(s.id)) return false;
            if (new Date(s.event_date || s.created_date) < sinceDate) return false;
            if (opts.filter && s.name !== opts.filter) return false;
            return true;
          });
          for (const step of matching.reverse()) {
            seen.add(step.id);
            formatEvent(step, opts);
          }
        } catch (e) {
          if (!opts.json) console.error(`poll error: ${e.message}`);
        }
      }

      await poll();
      setInterval(poll, 2500);
    });

  events
    .command('fire <event_name>')
    .description('Fire a single event via POST /v5/events')
    .option('--email <email>', 'email param shortcut')
    .option('--advocate_code <code>', 'advocate_code param shortcut')
    .option('--opportunity_id <id>', 'opportunity_id param shortcut')
    .option('--amount <amount>', 'amount param shortcut')
    .option('-p, --param <kv>', 'key=value param (repeatable)', collect, [])
    .option('--dry-run', 'Print request payload without sending')
    .option('--follow', 'After firing, tail the event stream for this email for 15s')
    .option('--follow-timeout <seconds>', 'How long to tail when using --follow', '15')
    .option('--json', 'Emit raw API response')
    .option('--compact', 'Strip nulls and empty fields from JSON output')
    .option('--token <token>', 'Override token')
    .option('--profile <profile>', 'Profile name', 'default')
    .action(async (eventName, opts) => {
      const token = resolveToken(opts);
      const data = {};
      if (opts.email) data.email = opts.email;
      if (opts.advocate_code) data.advocate_code = opts.advocate_code;
      if (opts.opportunity_id) data.opportunity_id = opts.opportunity_id;
      if (opts.amount) data.amount = opts.amount;
      for (const kv of opts.param) {
        const idx = kv.indexOf('=');
        if (idx < 0) { console.error(`Invalid param (expected key=value): ${kv}`); process.exit(2); }
        data[kv.slice(0, idx)] = kv.slice(idx + 1);
      }

      const payload = { event_name: eventName, data };
      if (opts.dryRun) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      const fireTime = new Date().toISOString();
      const res = await apiFetch('/v5/events', token, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(`Error ${res.status}: ${text.slice(0, 300)}`);
        process.exit(1);
      }

      if (opts.json) {
        try { printJson(JSON.parse(text), opts); } catch { process.stdout.write(text + '\n'); }
      } else {
        console.error(`OK  ${res.status}  fired ${eventName}`);
      }

      if (!opts.follow) return;

      // Tail person steps for this email for N seconds
      const email = opts.email || data.email;
      if (!email) {
        console.error('--follow requires --email to be set');
        process.exit(2);
      }

      const personId = await findPersonId(email, token);
      if (!personId) {
        console.error(`No person found for ${email} — cannot follow`);
        process.exit(1);
      }

      const timeoutMs = parseInt(opts.followTimeout) * 1000;
      const deadline = Date.now() + timeoutMs;
      const seen = new Set();

      console.error(`\nFollowing events for ${email} for ${opts.followTimeout}s...\n`);

      while (Date.now() < deadline) {
        await sleep(2000);
        try {
          const steps = await getPersonSteps(personId, token, 25);
          const newSteps = steps.filter(s => {
            if (seen.has(s.id)) return false;
            const stepTime = new Date(s.event_date || s.created_date).getTime();
            return stepTime >= new Date(fireTime).getTime();
          });
          for (const step of newSteps.reverse()) {
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
        } catch (e) {
          console.error(`poll error: ${e.message}`);
        }
      }

      console.error(`\nDone following (${opts.followTimeout}s).`);
    });

  return events;
}

function collect(val, prev) {
  return prev.concat([val]);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parseDuration(s) {
  if (!s) return null;
  const m = s.match(/^(\d+)(m|h|d)$/);
  if (!m) return null;
  const n = parseInt(m[1]);
  if (m[2] === 'm') return n * 60 * 1000;
  if (m[2] === 'h') return n * 3600 * 1000;
  if (m[2] === 'd') return n * 86400 * 1000;
  return null;
}
