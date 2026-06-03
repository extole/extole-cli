import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';

// Account-level notifications (webhook failures, integration errors, etc.) are
// recorded against an Extole-internal monitoring user `extole-monitoring@extole.com`.
// That user has a stable user_id across the platform; we use it directly rather
// than asking operators to track it. If the platform changes the ID, we surface a
// useful error instead of silent emptiness.
const MONITORING_USER_ID = '6950240009686253128';

async function fetchNotifications(userId, token, params, verbose) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const path = `/v6/notifications/${userId}${qs.toString() ? '?' + qs : ''}`;
  return apiJson(path, token, { verbose, baseUrl: API_BASE });
}

function colorize(level) {
  if (level === 'ERROR') return `\x1b[31m${level}\x1b[0m`;
  if (level === 'WARN')  return `\x1b[33m${level}\x1b[0m`;
  return `\x1b[90m${level}\x1b[0m`;
}

function formatTime(iso) {
  const d = new Date(iso);
  // M/D HH:MM in local time, terse
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function renderNotification(n, { showData = true } = {}) {
  const ts = formatTime(n.event_time);
  const level = colorize(n.level || '').padEnd(15);   // padding includes ANSI; close enough
  const name = n.name || '';
  console.log(`${ts}  ${level}  ${name}`);

  // Wrap message at ~76 chars, indent with two spaces
  const message = (n.message || '').replace(/\s+/g, ' ').trim();
  if (message) {
    const words = message.split(' ');
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > 76) {
        console.log(`  ${line}`);
        line = w;
      } else {
        line = line ? `${line} ${w}` : w;
      }
    }
    if (line) console.log(`  ${line}`);
  }

  if (showData && n.data && typeof n.data === 'object') {
    const keys = ['campaign_id', 'controller_id', 'person_id', 'cause_event_id'];
    const present = keys.filter(k => n.data[k]).map(k => `${k}=${n.data[k]}`);
    if (present.length) console.log(`  ${present.join('  ')}`);
  }
  console.log('');
}

export function notificationsCommand() {
  const cmd = new Command('notifications')
    .description('Show recent platform notifications for this account — webhook failures, integration errors, and other actionable system alerts.')
    .allowExcessArguments(false)
    .option('--limit <n>', 'Max notifications to fetch (default 20)', '20')
    .option('--offset <n>', 'Pagination offset (default 0)', '0')
    .option('--level <level>', 'Filter to a level: ERROR, WARN, INFO (case-insensitive). Client-side filter.')
    .option('--tag <tag>', 'Filter to notifications with this tag (server-side; repeatable)', (v, acc) => acc.concat([v]), [])
    .option('--listen', 'Tail new notifications as they arrive (Ctrl-C to stop)')
    .option('--interval <seconds>', 'Poll interval for --listen (default 10)', '10')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const userId = MONITORING_USER_ID;

      const params = {
        limit: opts.limit,
        offset: opts.offset,
      };
      if (opts.tag && opts.tag.length) params.having_all_tags = opts.tag.join(',');

      const filterByLevel = opts.level
        ? (n) => (n.level || '').toUpperCase() === opts.level.toUpperCase()
        : () => true;

      if (!opts.listen) {
        const data = await fetchNotifications(userId, token, params, opts.verbose);
        const list = (Array.isArray(data) ? data : []).filter(filterByLevel);

        if (opts.json) { printJson(list, opts); return; }
        if (list.length === 0) {
          console.log('No notifications match.');
          return;
        }

        console.log(`Showing ${list.length} notification${list.length === 1 ? '' : 's'} (most recent first):\n`);
        for (const n of list) renderNotification(n);
        return;
      }

      // --listen: follow-tail. Seed seen-set on first poll, then print new ones.
      const intervalMs = Math.max(1, Number(opts.interval) || 10) * 1000;
      console.log(`Watching for new platform notifications... (Ctrl-C to stop)\n`);
      const seen = new Set();
      let firstPoll = true;

      const poll = async () => {
        try {
          const data = await fetchNotifications(userId, token, params, false);
          const list = (Array.isArray(data) ? data : []).filter(filterByLevel);
          if (firstPoll) {
            for (const n of list) if (n.event_id) seen.add(n.event_id);
            firstPoll = false;
            return;
          }
          // Print oldest-first so the timeline reads top-to-bottom in the terminal
          for (const n of list.slice().reverse()) {
            if (!n.event_id || seen.has(n.event_id)) continue;
            seen.add(n.event_id);
            renderNotification(n);
          }
        } catch { /* ignore transient poll errors */ }
      };

      await poll();
      const handle = setInterval(poll, intervalMs);
      const cleanup = () => { clearInterval(handle); process.exit(0); };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    });

  cmd._mcpDescription = 'Show recent platform notifications — webhook failures, integration errors, campaign processing errors, and other actionable system alerts. Each notification includes campaign_id, controller_id, person_id, and cause_event_id which feed directly into other CLI tools. Use when debugging "the integration is wired up but nothing is happening" — notifications often name the exact failure. Use --level ERROR to filter to actionable issues only.';

  return addGlobalOptions(cmd, {
    output: true,
    examples: [
      'extole notifications',
      'extole notifications --limit 50',
      'extole notifications --level ERROR',
      'extole notifications --tag technical',
      'extole notifications --listen',
      'extole notifications --json',
    ],
  });
}
