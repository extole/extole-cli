import { Command } from 'commander';
import { resolveToken } from '../config.js';
import { apiJson, apiFetch } from '../api.js';
import { printJson } from '../output.js';

function formatEvent(ev, opts) {
  if (opts.json) {
    printJson(ev, opts);
    return;
  }
  const time = new Date(ev.event_time || ev.created_at || Date.now())
    .toLocaleTimeString('en-US', { hour12: false });
  const name = (ev.name || ev.event_name || '').padEnd(25);
  const params = Object.entries(ev.data || ev.parameters || {})
    .map(([k, v]) => `${k}=${v}`)
    .slice(0, 4)
    .join('  ');
  console.log(`${time}  ${name}  ${params}`);
}

export function eventsCommand() {
  const events = new Command('events');

  events
    .command('stream')
    .description('Tail live Extole events (polls every 2s)')
    .option('--filter <event_name>', 'Only show events matching this name')
    .option('--since <duration>', 'Start window (e.g. 10m, 1h, or ISO timestamp)', '10m')
    .option('--source <app_type>', 'Filter by app_type/source')
    .option('--json', 'Emit one JSON object per line')
    .option('--verbose', 'Full JSON output (no compaction)')
    .option('--token <token>', 'Override token')
    .option('--profile <profile>', 'Profile name', 'default')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const sinceMs = parseDuration(opts.since);
      let since = sinceMs ? new Date(Date.now() - sinceMs).toISOString() : opts.since;
      let seen = new Set();

      if (!opts.json) console.error(`Streaming events since ${since} — Ctrl+C to stop`);

      async function poll() {
        try {
          const params = new URLSearchParams({ since, limit: '50' });
          if (opts.filter) params.set('name', opts.filter);
          if (opts.source) params.set('app_type', opts.source);
          const data = await apiJson(`/v5/events?${params}`, token);
          const items = Array.isArray(data) ? data : (data.events || []);
          for (const ev of items.reverse()) {
            const id = ev.event_id || ev.id || JSON.stringify(ev);
            if (!seen.has(id)) {
              seen.add(id);
              formatEvent(ev, opts);
            }
          }
          if (items.length > 0) {
            const latest = items[items.length - 1];
            since = latest.event_time || latest.created_at || since;
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
    .option('--json', 'Emit raw API response')
    .option('--verbose', 'Full JSON output (no compaction)')
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

      const payload = { name: eventName, data };
      if (opts.dryRun) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      const res = await apiFetch('/v5/events', token, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      if (opts.json) {
        try { printJson(JSON.parse(text), opts); } catch { process.stdout.write(text + '\n'); }
      } else if (res.ok) {
        console.log(`OK  ${res.status}`);
        try { printJson(JSON.parse(text), opts); } catch { console.log(text); }
      } else {
        console.error(`Error ${res.status}: ${text.slice(0, 300)}`);
        process.exit(1);
      }
    });

  return events;
}

function collect(val, prev) {
  return prev.concat([val]);
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
