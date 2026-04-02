import { Command } from 'commander';
import { resolveToken } from '../config.js';
import { printJson } from '../output.js';

const STREAM_BASE = 'https://api.extole.io';

async function streamFetch(path, token, options = {}) {
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(`${STREAM_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`API error ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
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
  } catch { /* best effort */ }
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
  return new Command('stream')
    .description('Tail live Extole events in real time')
    .option('--filter <name>', 'Filter by event name (repeatable)', collect, [])
    .option('--email <email>', 'Filter to a specific person by email')
    .option('--event-type <type>', 'Filter by event type, repeatable (INPUT, REWARD, STEP, SHARE...)', collect, [])
    .option('--app-type <type>', 'Filter by app/source type, repeatable (e.g. salesforce_crm)', collect, [])
    .option('--sandbox <name>', 'Filter by sandbox/container name')
    .option('--json', 'Emit one JSON object per line')
    .option('--compact', 'Strip nulls and empty fields')
    .option('--token <token>', 'Override token')
    .option('--profile <profile>', 'Profile name', 'default')
    .action(async (opts) => {
      const token = resolveToken(opts);

      // Create ephemeral stream
      const stream = await createStream(token);
      const streamId = stream.id;
      process.stderr.write(`Stream ${streamId} created\n`);

      // Register cleanup on exit
      async function cleanup() {
        process.stderr.write('\nCleaning up stream...\n');
        await deleteStream(streamId, token);
        process.exit(0);
      }
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      // Add filters
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
        // Look up person ID for PERSON_ID filter
        try {
          const { default: fetch } = await import('node-fetch');
          const res = await fetch(`https://api.extole.io/v5/persons?identity_key_value=${encodeURIComponent(opts.email)}&limit=1`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
          });
          const people = await res.json();
          if (Array.isArray(people) && people.length > 0) {
            filterPromises.push(addFilter(streamId, { type: 'PERSON_ID', person_ids: [people[0].id] }, token));
          } else {
            process.stderr.write(`Warning: no person found for ${opts.email}, streaming without person filter\n`);
          }
        } catch (e) {
          process.stderr.write(`Warning: person lookup failed: ${e.message}\n`);
        }
      }

      await Promise.all(filterPromises);

      if (!opts.json) process.stderr.write('Streaming events — Ctrl+C to stop\n\n');

      // Poll for events
      const seen = new Set();
      let since = new Date().toISOString();

      async function poll() {
        try {
          const items = await readEvents(streamId, token, since);
          for (const item of items) {
            const id = item.event_id || JSON.stringify(item);
            if (!seen.has(id)) {
              seen.add(id);
              // Skip internal stream management events
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
        }
      }

      await poll();
      setInterval(poll, 2500);
    });
}

function collect(val, prev) {
  return prev.concat([val]);
}
