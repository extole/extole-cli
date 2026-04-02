import { Command } from 'commander';
import { resolveToken } from '../config.js';
import { apiJson, apiFetch } from '../api.js';
import { printJson } from '../output.js';
import { findPerson, getPersonSteps } from './person.js';


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
    .command('fire <event_name>')
    .description('Fire a single event via POST /v5/events')
    .option('--email <email>', 'email param shortcut')
    .option('--advocate_code <code>', 'advocate_code param shortcut')
    .option('--opportunity_id <id>', 'opportunity_id param shortcut')
    .option('--amount <amount>', 'amount param shortcut')
    .option('-p, --param <kv>', 'key=value param (repeatable)', collect, [])
    .option('--dry-run', 'Print request payload without sending')
    .option('--watch', 'After firing, tail the event stream for this email for 15s')
    .option('--watch-timeout <seconds>', 'How long to tail when using --watch', '15')
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

      if (!opts.watch) return;

      // Tail person steps for this email for N seconds
      const email = opts.email || data.email;
      if (!email) {
        console.error('--watch requires --email to be set');
        process.exit(2);
      }

      const match = await findPerson(email, token);
      if (!match) {
        console.error(`No person found for ${email} — cannot watch`);
        process.exit(1);
      }

      const timeoutMs = parseInt(opts.watchTimeout) * 1000;
      const deadline = Date.now() + timeoutMs;
      const seen = new Set();

      console.error(`\nWatching steps for ${email} for ${opts.watchTimeout}s...\n`);

      while (Date.now() < deadline) {
        await sleep(2000);
        try {
          const steps = await getPersonSteps(match.id, token, 25);
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

      console.error(`\nDone watching (${opts.watchTimeout}s).`);
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
