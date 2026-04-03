import { Command } from 'commander';
import { resolveToken, PERSON_BASE } from '../config.js';
import { printJson } from '../output.js';
import { collect, addGlobalOptions } from '../utils.js';
import { findPerson } from './person.js';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_POLL_ERRORS = 10;
const SEEN_MAX_SIZE = 5000;
const SEEN_KEEP_SIZE = 4000;

async function streamFetch(path, token, options = {}) {
  const { default: fetch } = await import('node-fetch');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${PERSON_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(options.headers || {}),
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

async function createStream(token) {
  const stop_at = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  return streamFetch('/v6/event-streams', token, {
    method: 'POST',
    body: JSON.stringify({ name: 'extole-cli', tags: ['cli'], stop_at }),
  });
}

async function addFilter(streamId, filter, token) {
  return streamFetch(`/v6/event-streams/${streamId}/filters`, token, {
    method: 'POST',
    body: JSON.stringify(filter),
  });
}

async function deleteStream(streamId, token) {
  try {
    await streamFetch(`/v6/event-streams/${streamId}/delete`, token, { method: 'POST' });
  } catch (e) {
    process.stderr.write(`Warning: stream cleanup failed: ${e.message}\n`);
  }
}

async function readEvents(streamId, token, since) {
  const params = new URLSearchParams({ limit: '50', offset: '0' });
  if (since) params.set('start_date', since);
  return streamFetch(`/v6/event-streams/${streamId}/events?${params}`, token);
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

      const stream = await createStream(token);
      const streamId = stream.id;
      process.stderr.write(`Stream ${streamId} created\n`);

      async function cleanup() {
        process.stderr.write('\nCleaning up stream...\n');
        await deleteStream(streamId, token);
        process.exit(0);
      }
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      const filterPromises = [];

      if (opts.filter.length > 0) {
        filterPromises.push(addFilter(streamId, { type: 'EVENT_NAME', event_names: opts.filter }, token));
      }
      if (opts.eventType.length > 0) {
        filterPromises.push(addFilter(streamId, { type: 'EVENT_TYPE', event_types: opts.eventType }, token));
      }
      if (opts.appType.length > 0) {
        filterPromises.push(addFilter(streamId, { type: 'APPLICATION_TYPE', app_types: opts.appType }, token));
      }
      if (opts.sandbox) {
        filterPromises.push(addFilter(streamId, { type: 'SANDBOX', sandboxes: [opts.sandbox] }, token));
      }
      if (opts.email) {
        try {
          const match = await findPerson(opts.email, token);
          if (match) {
            filterPromises.push(addFilter(streamId, { type: 'PERSON_ID', person_ids: [match.id] }, token));
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
          const items = await readEvents(streamId, token, since);
          errorCount = 0;
          for (const item of items) {
            const id = item.event_id || JSON.stringify(item);
            if (!seen.has(id)) {
              seen.add(id);
              if (seen.size > SEEN_MAX_SIZE) {
                const arr = [...seen];
                seen.clear();
                arr.slice(-SEEN_KEEP_SIZE).forEach(i => seen.add(i));
              }
              const evName = item.event?.name || '';
              if (evName === 'config_change') continue;
              formatStreamEvent(item, opts);
            }
          }
          if (items.length > 0) {
            since = items[items.length - 1].event_time || since;
          }
        } catch (e) {
          process.stderr.write(`poll error: ${e.message}\n`);
          if (++errorCount >= MAX_POLL_ERRORS) {
            process.stderr.write('Too many consecutive poll errors, stopping.\n');
            process.exit(1);
          }
        }
      }

      await poll();
      setInterval(poll, 2500);
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
