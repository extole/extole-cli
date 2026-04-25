import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';
import { apiFetch, apiJson } from '../api.js';
import { printJson } from '../output.js';
import { collect, addGlobalOptions, SEEN_MAX_SIZE, SEEN_KEEP_SIZE, POLL_INTERVAL_MS } from '../utils.js';
import { findPerson } from '../person-api.js';

const INTERNAL_EVENT_NAMES = new Set(['config_change']);
const STREAM_EXPIRY_MS = 2 * 3600 * 1000; // 2 hours
const MAX_STREAM_FIELDS = 3;

async function createStream(token, verbose) {
  const stop_at = new Date(Date.now() + STREAM_EXPIRY_MS).toISOString();
  return apiJson('/v6/event-streams', token, {
    method: 'POST',
    body: JSON.stringify({ name: 'extole-cli', tags: ['cli'], stop_at }),
    baseUrl: API_BASE,
    verbose,
  });
}

async function addFilter(streamId, filter, token, verbose) {
  return apiJson(`/v6/event-streams/${streamId}/filters`, token, {
    method: 'POST',
    body: JSON.stringify(filter),
    baseUrl: API_BASE,
    verbose,
  });
}

async function deleteStream(streamId, token, verbose) {
  try {
    await apiFetch(`/v6/event-streams/${streamId}/delete`, token, {
      method: 'POST',
      baseUrl: API_BASE,
      verbose,
    });
  } catch (e) {
    process.stderr.write(`Warning: stream cleanup failed: ${e.message}\n`);
  }
}

async function readEvents(streamId, token, since, verbose) {
  const params = new URLSearchParams({ limit: '50', offset: '0' });
  if (since) params.set('start_date', since);
  return apiJson(`/v6/event-streams/${streamId}/events?${params}`, token, {
    baseUrl: API_BASE,
    verbose,
  });
}

function formatStreamEvent(item, opts) {
  if (opts.json) {
    printJson(item, opts);
    return;
  }
  const ev = item.event || item;
  const time = new Date(item.event_time || ev.event_time || Date.now())
    .toLocaleTimeString('en-US', { hour12: false });
  const name = (ev.name || '').padEnd(35);
  const entries = ev.data ? Object.entries(ev.data)
    .filter(([, v]) => v && (typeof v !== 'object' || v.scope !== 'CLIENT_ADMIN'))
    .map(([k, v]) => {
      const val = typeof v === 'object' && v !== null ? (v.value ?? JSON.stringify(v)) : v;
      return `${k}=${val}`;
    }) : [];
  const truncated = entries.length > MAX_STREAM_FIELDS ? `  (+${entries.length - MAX_STREAM_FIELDS} more)` : '';
  const data = entries.slice(0, MAX_STREAM_FIELDS).join('  ') + truncated;
  console.log(`${time}  ${name}  ${data}`);
}

export function streamCommand() {
  const cmd = new Command('stream')
    .description('Tail live Extole events in real time')
    .allowExcessArguments(false)
    .option('--filter <name>', 'Filter by event name (repeatable)', collect, [])
    .option('--email <email>', 'Filter to a specific person by email')
    .option('--event-type <type>', 'Filter by event type, repeatable (INPUT, REWARD, STEP, SHARE...)', collect, [])
    .option('--app-type <type>', 'Filter by app/source type (repeatable)', collect, [])
    .option('--sandbox <name>', 'Filter by sandbox/container name')
    .action(async (opts) => {
      const token = resolveToken(opts);

      const stream = await createStream(token, opts.verbose);
      const streamId = stream.id;
      process.stderr.write(`Stream ${streamId} created (expires in 2 hours)\n`);

      function cleanup(exitCode) {
        process.stderr.write('\nCleaning up stream...\n');
        deleteStream(streamId, token, opts.verbose).finally(() => process.exit(exitCode));
      }
      process.once('SIGINT', () => cleanup(130));
      process.once('SIGTERM', () => cleanup(143));

      const filterPromises = [];

      if (opts.filter.length > 0) {
        filterPromises.push(addFilter(streamId, { type: 'EVENT_NAME', event_names: opts.filter }, token, opts.verbose));
      }
      if (opts.eventType.length > 0) {
        filterPromises.push(addFilter(streamId, { type: 'EVENT_TYPE', event_types: opts.eventType }, token, opts.verbose));
      }
      if (opts.appType.length > 0) {
        filterPromises.push(addFilter(streamId, { type: 'APPLICATION_TYPE', app_types: opts.appType }, token, opts.verbose));
      }
      if (opts.sandbox) {
        filterPromises.push(addFilter(streamId, { type: 'SANDBOX', sandboxes: [opts.sandbox] }, token, opts.verbose));
      }
      if (opts.email) {
        filterPromises.push(
          findPerson(opts.email, token, opts.verbose)
            .then(match => {
              if (match) {
                return addFilter(streamId, { type: 'PERSON_ID', person_ids: [match.id] }, token, opts.verbose);
              }
              process.stderr.write(`Warning: no person found for ${opts.email}, streaming without person filter\n`);
            })
            .catch(e => {
              process.stderr.write(`Warning: person lookup failed: ${e.message}\n`);
            })
        );
      }

      await Promise.all(filterPromises);

      if (!opts.json) process.stderr.write('Streaming events — Ctrl+C to stop\n\n');

      const seen = new Set();
      let since = new Date().toISOString();
      let errorCount = 0;

      async function poll() {
        try {
          const items = await readEvents(streamId, token, since, opts.verbose);
          errorCount = 0;
          for (const item of items) {
            const id = item.event_id || null;
            if (id && seen.has(id)) continue;
            if (id) {
              seen.add(id);
              if (seen.size > SEEN_MAX_SIZE) {
                const arr = [...seen];
                seen.clear();
                arr.slice(-SEEN_KEEP_SIZE).forEach(i => seen.add(i));
              }
            }
            const evName = item.event?.name || '';
            if (INTERNAL_EVENT_NAMES.has(evName)) continue;
            formatStreamEvent(item, opts);
          }
          if (items.length > 0) {
            const last = items[items.length - 1];
            since = last.event_time || last.event?.event_time || since;
          }
        } catch (e) {
          process.stderr.write(`poll error: ${e.message}\n`);
          if (++errorCount >= 10) {
            process.stderr.write('Too many consecutive poll errors, stopping.\n');
            process.exit(1);
          }
        }
      }

      async function schedulePoll() {
        await poll();
        setTimeout(schedulePoll, POLL_INTERVAL_MS);
      }
      await schedulePoll();
    });

  return addGlobalOptions(cmd, {
    output: true,
    examples: [
      'extole stream',
      'extole stream --app-type my_integration',
      'extole stream --email jane@example.com',
      'extole stream --filter lead_created --filter opp_closed_won',
      'extole stream --event-type REWARD',
    ],
  });
}
