import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';

async function fetchAudiences(token, verbose) {
  return apiJson('/v1/audiences', token, { verbose, baseUrl: API_BASE });
}

async function fetchAudience(id, token, verbose) {
  return apiJson(`/v1/audiences/${id}`, token, { verbose, baseUrl: API_BASE });
}

async function fetchAudienceStats(id, token, verbose) {
  return apiJson(`/v1/audiences/${id}/stats`, token, { verbose, baseUrl: API_BASE });
}

async function fetchAudienceMembers(id, token, verbose, { limit = 100, offset = 0 } = {}) {
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return apiJson(`/v1/audiences/${id}/members/view/details?${qs}`, token, { verbose, baseUrl: API_BASE });
}

async function fetchAudienceOperations(id, token, verbose, { limit = 20 } = {}) {
  const qs = new URLSearchParams({ limit: String(limit) });
  return apiJson(`/v1/audiences/${id}/operations?${qs}`, token, { verbose, baseUrl: API_BASE });
}

// Resolve a `<name|id>` argument to a single audience. Tries exact ID first,
// then exact name match, then substring name match. Errors on ambiguity.
async function resolveAudience(arg, token, verbose) {
  const all = await fetchAudiences(token, verbose);
  const list = Array.isArray(all) ? all : [];
  const byId = list.find(a => a.id === arg);
  if (byId) return byId;

  const nameOf = (a) => (typeof a.name === 'string' ? a.name : (a.name?.value || a.name?.default || ''));

  const exactName = list.filter(a => nameOf(a) === arg);
  if (exactName.length === 1) return exactName[0];
  if (exactName.length > 1) {
    console.error(`Multiple audiences with exact name "${arg}":`);
    for (const a of exactName) console.error(`  ${a.id}  ${nameOf(a)}`);
    process.exit(2);
  }

  const needle = arg.toLowerCase();
  const fuzzy = list.filter(a => nameOf(a).toLowerCase().includes(needle));
  if (fuzzy.length === 0) {
    console.error(`No audience matched "${arg}".`);
    process.exit(1);
  }
  if (fuzzy.length > 1) {
    console.error(`Multiple audiences match "${arg}":`);
    for (const a of fuzzy) console.error(`  ${a.id}  ${nameOf(a)}`);
    console.error('Use a more specific substring or pass the audience ID.');
    process.exit(2);
  }
  return fuzzy[0];
}

function nameOf(a) {
  return typeof a?.name === 'string' ? a.name : (a?.name?.value || a?.name?.default || '');
}

function enabledOf(a) {
  if (typeof a?.enabled === 'boolean') return a.enabled;
  return a?.enabled?.value ?? a?.enabled?.default ?? null;
}

export function audiencesCommand() {
  const audiences = new Command('audiences')
    .description('Inspect audiences: list, members, recent push/sync history');

  // ── list ────────────────────────────────────────────────────────────────

  const listCmd = new Command('list')
    .description('List audiences configured on the account')
    .allowExcessArguments(false)
    .option('--filter <substr>', 'Case-insensitive substring match on audience name')
    .option('--limit <n>', 'Cap the number of audiences displayed (default 100)', '100')
    .action(async function () {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const data = await fetchAudiences(token, opts.verbose);
      let list = Array.isArray(data) ? data : [];
      const total = list.length;

      if (opts.filter) {
        const needle = opts.filter.toLowerCase();
        list = list.filter(a => (nameOf(a) || '').toLowerCase().includes(needle));
      }

      const limit = Math.max(1, parseInt(opts.limit, 10) || 100);
      const limited = list.slice(0, limit);
      const truncated = list.length > limit;

      if (opts.json) { printJson(limited, opts); return; }
      if (limited.length === 0) {
        console.log(opts.filter
          ? `No audiences match "${opts.filter}".`
          : 'No audiences configured.');
        return;
      }

      const rows = limited.map(a => ({
        id: a.id || '',
        name: nameOf(a) || '(unnamed)',
        enabled: enabledOf(a) === false ? 'off' : 'on',
        tags: Array.isArray(a.tags) ? a.tags.filter(t => !t.startsWith('internal:')).join(', ') : '',
      }));

      const idW = Math.max('id'.length, ...rows.map(r => r.id.length));
      const nameW = Math.max('name'.length, ...rows.map(r => r.name.length));
      const enabledW = Math.max('enabled'.length, ...rows.map(r => r.enabled.length));

      console.log(`${'id'.padEnd(idW)}  ${'name'.padEnd(nameW)}  ${'enabled'.padEnd(enabledW)}  tags`);
      console.log(`${'─'.repeat(idW)}  ${'─'.repeat(nameW)}  ${'─'.repeat(enabledW)}  ${'─'.repeat(20)}`);
      for (const r of rows) {
        console.log(`${r.id.padEnd(idW)}  ${r.name.padEnd(nameW)}  ${r.enabled.padEnd(enabledW)}  ${r.tags}`);
      }

      if (truncated) {
        const matched = opts.filter ? ` matching "${opts.filter}"` : '';
        console.log(`\n${limited.length} of ${list.length}${matched} shown (--limit ${limit}). Pass --limit ${list.length} to see all, or refine with --filter.`);
      } else if (opts.filter && list.length < total) {
        console.log(`\n${list.length} of ${total} total audiences matched "${opts.filter}".`);
      }
    });

  addGlobalOptions(listCmd, {
    output: true,
    examples: [
      'extole audiences list',
      'extole audiences list --filter sfdc',
      'extole audiences list --limit 500',
      'extole audiences list --json',
    ],
  });

  // ── get ─────────────────────────────────────────────────────────────────

  const getCmd = new Command('get')
    .description('Show audience detail: name, enabled, tags, size, recent history summary')
    .allowExcessArguments(false)
    .argument('<audience>', 'Audience name (substring match) or audience ID')
    .action(async function (arg) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const target = await resolveAudience(arg, token, opts.verbose);

      const [detail, stats, ops] = await Promise.all([
        fetchAudience(target.id, token, opts.verbose).catch(() => target),
        fetchAudienceStats(target.id, token, opts.verbose).catch(() => null),
        fetchAudienceOperations(target.id, token, opts.verbose, { limit: 3 }).catch(() => []),
      ]);

      if (opts.json) {
        printJson({ audience: detail, stats, recent_history: ops }, opts);
        return;
      }

      const enabled = enabledOf(detail);
      console.log(`id:        ${detail.id}`);
      console.log(`name:      ${nameOf(detail)}`);
      console.log(`enabled:   ${enabled === false ? 'off' : 'on'}`);
      if (Array.isArray(detail.tags) && detail.tags.length) {
        const visible = detail.tags.filter(t => !t.startsWith('internal:'));
        if (visible.length) console.log(`tags:      ${visible.join(', ')}`);
      }
      if (stats && typeof stats.active_members_count === 'number') {
        console.log(`size:      ${stats.active_members_count} active member${stats.active_members_count === 1 ? '' : 's'}`);
      }

      if (Array.isArray(ops) && ops.length) {
        console.log(`\nRecent history (${ops.length}):`);
        for (const o of ops) {
          const ds = o.data_source?.type || '';
          console.log(`  ${o.id}  ${o.type || ''}  ${ds}`);
        }
        console.log(`\nRun \`extole audiences history ${detail.id}\` for the full list.`);
      }
    });

  addGlobalOptions(getCmd, {
    output: true,
    examples: [
      'extole audiences get sfdc_pushed',
      'extole audiences get <audience-id>',
      'extole audiences get <audience-id> --json',
    ],
  });

  // ── members ─────────────────────────────────────────────────────────────

  const membersCmd = new Command('members')
    .description('List members of an audience')
    .allowExcessArguments(false)
    .argument('<audience>', 'Audience name (substring match) or audience ID')
    .option('--limit <n>', 'Max members to fetch (default 100)', '100')
    .option('--offset <n>', 'Pagination offset (default 0)', '0')
    .option('--email-only', 'Print just emails, one per line (skip rows with no email)')
    .action(async function (arg) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const target = await resolveAudience(arg, token, opts.verbose);

      const data = await fetchAudienceMembers(target.id, token, opts.verbose, {
        limit: opts.limit,
        offset: opts.offset,
      });
      const list = Array.isArray(data) ? data : (data?.members || []);

      if (opts.json) { printJson(list, opts); return; }

      if (list.length === 0) {
        console.log(`No members returned for ${nameOf(target)} (${target.id}).`);
        return;
      }

      const emailOf = (m) => m.email || m.data?.email?.value || m.person?.email || null;

      if (opts.emailOnly) {
        let printed = 0;
        for (const m of list) {
          const e = emailOf(m);
          if (e) { console.log(e); printed++; }
        }
        if (printed === 0) {
          console.error('(no email addresses available on returned members)');
          process.exit(1);
        }
        return;
      }

      const rows = list.map(m => ({
        person_id: m.person_id || m.id || '',
        email: emailOf(m) || '(no email)',
      }));
      const idW = Math.max('person_id'.length, ...rows.map(r => r.person_id.length));
      console.log(`${'person_id'.padEnd(idW)}  email`);
      console.log(`${'─'.repeat(idW)}  ${'─'.repeat(40)}`);
      for (const r of rows) console.log(`${r.person_id.padEnd(idW)}  ${r.email}`);

      console.log(`\n${list.length} member${list.length === 1 ? '' : 's'} shown (limit=${opts.limit}, offset=${opts.offset}). Use --limit/--offset to page.`);
    });

  addGlobalOptions(membersCmd, {
    output: true,
    examples: [
      'extole audiences members sfdc_pushed',
      'extole audiences members sfdc_pushed --email-only',
      'extole audiences members sfdc_pushed --limit 500 --offset 1000',
    ],
  });

  // ── history ─────────────────────────────────────────────────────────────

  const historyCmd = new Command('history')
    .description('Show recent ADD / REMOVE / REPLACE / ACTION runs against an audience. Use --watch to tail new runs as they arrive.')
    .allowExcessArguments(false)
    .argument('<audience>', 'Audience name (substring match) or audience ID')
    .option('--limit <n>', 'Max history entries to show (default 20)', '20')
    .option('--watch', 'Poll for new runs and print them as they arrive (Ctrl-C to stop)')
    .option('--interval <seconds>', 'Poll interval in seconds when --watch is set (default 5)', '5')
    .action(async function (arg) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const target = await resolveAudience(arg, token, opts.verbose);

      const fetchOnce = () => fetchAudienceOperations(target.id, token, opts.verbose, { limit: opts.limit });
      const printRow = (o, indent = '') => {
        const ds = o.data_source?.type || '';
        const tags = Array.isArray(o.tags) && o.tags.length ? `  tags=${o.tags.join(',')}` : '';
        console.log(`${indent}${o.id}  ${(o.type || '').padEnd(8)}  ${ds}${tags}`);
      };

      if (!opts.watch) {
        const data = await fetchOnce();
        const list = Array.isArray(data) ? data : [];

        if (opts.json) { printJson(list, opts); return; }
        if (list.length === 0) {
          console.log(`No history for ${nameOf(target)} (${target.id}).`);
          return;
        }
        console.log(`Recent runs for ${nameOf(target)} (${target.id}):`);
        console.log(`${'id'.padEnd(24)}  ${'type'.padEnd(8)}  data_source`);
        console.log(`${'─'.repeat(24)}  ${'─'.repeat(8)}  ${'─'.repeat(30)}`);
        for (const o of list) printRow(o);
        return;
      }

      // --watch: follow-tail. Seed the seen-set on the first poll (don't dump history).
      const intervalMs = Math.max(1, Number(opts.interval) || 5) * 1000;
      console.log(`Watching ${nameOf(target)} (${target.id}) for new runs... (Ctrl-C to stop)\n`);
      const seen = new Set();
      let firstPoll = true;

      const poll = async () => {
        try {
          const data = await fetchOnce();
          const list = Array.isArray(data) ? data : [];
          if (firstPoll) {
            for (const o of list) if (o.id) seen.add(o.id);
            firstPoll = false;
            return;
          }
          for (const o of list.slice().reverse()) {
            if (!o.id || seen.has(o.id)) continue;
            seen.add(o.id);
            const ts = new Date().toISOString().slice(11, 19);
            printRow(o, `${ts}  `);
          }
        } catch { /* ignore transient errors */ }
      };

      await poll();
      const handle = setInterval(poll, intervalMs);
      const cleanup = () => { clearInterval(handle); process.exit(0); };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    });

  addGlobalOptions(historyCmd, {
    output: true,
    examples: [
      'extole audiences history sfdc_pushed',
      'extole audiences history sfdc_pushed --limit 50',
      'extole audiences history sfdc_pushed --watch',
      'extole audiences history sfdc_pushed --watch --interval 3',
    ],
  });

  audiences.addCommand(listCmd);
  audiences.addCommand(getCmd);
  audiences.addCommand(membersCmd);
  audiences.addCommand(historyCmd);

  return audiences;
}
