import { Command } from 'commander';
import { resolveToken, PERSON_BASE } from '../config.js';
import { apiFetch, apiJson } from '../api.js';
import { printJson } from '../output.js';
import { collect, addGlobalOptions, SEEN_MAX_SIZE, SEEN_KEEP_SIZE } from '../utils.js';
import { findPerson } from '../person-api.js';

async function createStream(token, verbose) {
  const stop_at = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  return apiJson('/v6/event-streams', token, {
    method: 'POST',
    body: JSON.stringify({ name: 'extole-cli', tags: ['cli'], stop_at }),
    baseUrl: PERSON_BASE,
    verbose,
  });
}

async function addFilter(streamId, filter, token, verbose) {
  return apiJson(`/v6/event-streams/${streamId}/filters`, token, {
    method: 'POST',
    body: JSON.stringify(filter),
    baseUrl: PERSON_BASE,
    verbose,
  });
}

async function deleteStream(streamId, token, verbose) {
  try {
    await apiFetch(`/v6/event-streams/${streamId}/delete`, token, {
      method: 'POST',
      baseUrl: PERSON_BASE,
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
    baseUrl: PERSON_BASE,
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
  const data = ev.data ? Object.entries(ev.data)
    .filter(([, v]) => v && v.scope !== 'CLIENT_ADMIN')
    .map(([k, v]) => `${k}=${v.value || v}`)
    .slice(0, 3)
    .join('  ') : '';
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
      process.stderr.write(`Stream ${streamId} created\n`);

      async function cleanup() {
        process.stderr.write('\nCleaning up stream...\n');
        await deleteStream(streamId, token, opts.verbose);
        process.exit(0);
      }
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

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
        try {
          const match = await findPerson(opts.email, token, opts.verbose);
          if (match) {
            filterPromises.push(addFilter(streamId, { type: 'PERSON_ID', person_ids: [match.id] }, token, opts.verbose));
          } else {
            process.stderr.write(`Warning: no person found for ${opts.email}, streaming without person filter\n`);
          }
        } catch (e) {
          process.stderr.write(`Warning: person lookup failed: ${e.message}\n`);
        }
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
            if (evName === 'config_change') continue;
            formatStreamEvent(item, opts);
          }
          if (items.length > 0) {
            since = items[items.length - 1].event_time || since;
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
        setTimeout(schedulePoll, 2500);
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
