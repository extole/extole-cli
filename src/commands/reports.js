import { Command } from 'commander';
import { resolveToken } from '../config.js';
import { apiJson, apiFetch } from '../api.js';
import { printJson, printJsonText } from '../output.js';
import { collect, sleep, addGlobalOptions, formatEventDate } from '../utils.js';

const REPORT_POLL_MAX_ATTEMPTS = 240; // 240 attempts × 1.5s = 6 minutes
const TERMINAL_STATES = new Set(['DONE', 'FAILED', 'CANCELLED', 'EXPIRED']);

async function pollUntilDone(reportId, token, verbose) {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let frame = 0;
  let status = '';
  let pollAttempts = 0;
  let pollErrors = 0;
  const MAX_POLL_ERRORS = 5;
  while (!TERMINAL_STATES.has(status)) {
    if (++pollAttempts > REPORT_POLL_MAX_ATTEMPTS) {
      process.stderr.write('\r\x1b[K');
      console.error(`Report did not complete after ${REPORT_POLL_MAX_ATTEMPTS} attempts. Last status: ${status || 'unknown'}`);
      process.exit(1);
    }
    await sleep(1500);
    try {
      const poll = await apiJson(`/v4/reports/${reportId}`, token, { verbose });
      pollErrors = 0;
      status = poll.status;
      if (!status || typeof status !== 'string') {
        process.stderr.write('\r\x1b[K');
        console.error(`Unexpected response from report status check: ${JSON.stringify(poll).slice(0, 200)}`);
        process.exit(1);
      }
    } catch (e) {
      if (++pollErrors >= MAX_POLL_ERRORS) {
        process.stderr.write('\r\x1b[K');
        console.error(`Too many poll errors: ${e.message}`);
        process.exit(1);
      }
      process.stderr.write(`\r  poll error (${pollErrors}/${MAX_POLL_ERRORS}): ${e.message}    `);
      continue;
    }
    process.stderr.write(`\r${frames[frame++ % frames.length]}  ${status}    `);
  }
  process.stderr.write('\r\x1b[K');
  return status;
}

export function reportsCommand() {
  const reports = new Command('reports')
    .description('List report runners and run on-demand reports')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const data = await apiJson('/v7/report-runners', token, { verbose: opts.verbose });
      const runners = Array.isArray(data) ? data : (data.runners || []);
      if (opts.json) {
        printJson(runners, opts);
        return;
      }
      if (runners.length === 0) { console.log('No report runners found.'); return; }
      const col1 = Math.max(20, ...runners.map(r => (r.runner_id || r.id || '').length)) + 2;
      console.log('runner_id'.padEnd(col1) + 'display_name');
      console.log('─'.repeat(col1) + '─'.repeat(40));
      for (const r of runners) {
        console.log(`${(r.runner_id || r.id || '').padEnd(col1)}${r.display_name || r.name || ''}`);
      }
    });

  addGlobalOptions(reports, {
    output: true,
    examples: [
      'extole reports',
      'extole reports --json',
    ],
  });

  const typesCmd = new Command('types')
    .description('List available report types')
    .allowExcessArguments(false)
    .option('--filter <substr>', 'Case-insensitive substring match against name, display_name, description, and categories')
    .action(async function () {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const data = await apiJson('/v6/report-types', token, { verbose: opts.verbose });
      let types = Array.isArray(data) ? data : (data.report_types || []);

      if (opts.filter) {
        const needle = opts.filter.toLowerCase();
        types = types.filter(t => {
          const haystack = [
            t.report_type, t.name, t.display_name, t.description,
            ...(t.categories || []),
          ].filter(Boolean).join(' ').toLowerCase();
          return haystack.includes(needle);
        });
      }

      if (opts.json) {
        printJson(types, opts);
        return;
      }
      if (types.length === 0) {
        console.log(opts.filter
          ? `No report types match "${opts.filter}".`
          : 'No report types found.');
        return;
      }
      const col1 = Math.max(20, ...types.map(t => (t.report_type || t.name || '').length)) + 2;
      const col2 = 35;
      console.log('report_type'.padEnd(col1) + 'display_name'.padEnd(col2) + 'executor_type');
      console.log('─'.repeat(col1) + '─'.repeat(col2) + '─'.repeat(20));
      for (const t of types) {
        const id = (t.report_type || t.name || '').padEnd(col1);
        const name = (t.display_name || '').slice(0, col2 - 2).padEnd(col2);
        console.log(`${id}${name}${t.executor_type || ''}`);
      }
    });

  addGlobalOptions(typesCmd, {
    output: true,
    examples: [
      'extole reports types',
      'extole reports types --filter engagement',
      'extole reports types --filter "customer activity"',
      'extole reports types --json | jq \'.[].report_type\'',
    ],
  });

  // ── recommended ───────────────────────────────────────────────────────────

  const recommendedCmd = new Command('recommended')
    .description('Show curated report-type recommendations for this account')
    .allowExcessArguments(false)
    .option('--limit <n>', 'Max number of recommendations (default 5)')
    .action(async function () {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const qs = opts.limit ? `?limit=${encodeURIComponent(opts.limit)}` : '';
      const data = await apiJson(`/v6/report-types/recommendations${qs}`, token, { verbose: opts.verbose });
      const recs = Array.isArray(data) ? data : (data.report_types || []);

      if (opts.json) {
        printJson(recs, opts);
        return;
      }
      if (recs.length === 0) {
        console.log('No recommendations available.');
        return;
      }

      console.log(`Recommended report types (${recs.length}):\n`);
      const stripHtml = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const wrap = (text, width, indent) => {
        const words = text.split(' ');
        const lines = [];
        let line = '';
        for (const w of words) {
          if ((line + ' ' + w).trim().length > width) {
            if (line) lines.push(line);
            line = w;
          } else {
            line = line ? `${line} ${w}` : w;
          }
        }
        if (line) lines.push(line);
        return lines.map(l => `${indent}${l}`).join('\n');
      };

      for (const r of recs) {
        const id = r.report_type || r.name || '';
        const display = r.display_name || '';
        const cats = (r.categories && r.categories.length) ? `  [${r.categories.join(', ')}]` : '';
        console.log(`  ${id}    ${display}${cats}`);
        const desc = stripHtml(r.description);
        if (desc) console.log(wrap(desc, 76, '    '));
        console.log('');
      }
      console.log('Run `extole reports describe --type <name>` to see parameters; `extole reports run --type <name> ...` to execute.');
    });

  addGlobalOptions(recommendedCmd, {
    output: true,
    examples: [
      'extole reports recommended',
      'extole reports recommended --limit 10',
      'extole reports recommended --json',
    ],
  });

  const runCmd = new Command('run')
    .description('Create an on-demand report')
    .allowExcessArguments(false)
    .option('--type <type>', 'Report type (e.g. summary, summary_per_program)')
    .option('-p, --param <kv>', 'key=value parameter (repeatable)', collect, [])
    .option('--days <n>', 'Shortcut: set time_range to last N days')
    .option('--wait', 'Poll until report is complete')
    .option('--download', 'Download and print result (implies --wait)')
    .action(async function () {
      const opts = this.optsWithGlobals();
      if (!opts.type) {
        console.error('Error: --type REPORT_TYPE is required. Run `extole reports types` to see available types.');
        process.exit(2);
      }
      const token = resolveToken(opts);
      const parameters = {};
      for (const kv of opts.param) {
        const idx = kv.indexOf('=');
        if (idx < 0) { console.error(`Invalid param (expected key=value): ${kv}`); process.exit(2); }
        parameters[kv.slice(0, idx)] = kv.slice(idx + 1);
      }
      if (opts.days && parameters.time_range) {
        console.error('Error: --days and -p time_range are mutually exclusive.');
        process.exit(2);
      }
      if (opts.days && !parameters.time_range) {
        const days = parseInt(opts.days, 10);
        if (isNaN(days) || days <= 0) {
          console.error('--days must be a positive integer');
          process.exit(2);
        }
        const end = new Date();
        const start = new Date(end.getTime() - days * 86400 * 1000);
        parameters.time_range = `${start.toISOString()}/${end.toISOString()}`;
      }

      const body = { report_type: opts.type, parameters };
      const createRes = await apiFetch('/v4/reports', token, {
        method: 'POST',
        body: JSON.stringify(body),
        verbose: opts.verbose,
      });
      const createText = await createRes.text();
      if (!createRes.ok) {
        console.error(`Create failed ${createRes.status}: ${createText.slice(0, 300)}`);
        process.exit(1);
      }
      let report;
      try {
        report = JSON.parse(createText);
      } catch {
        console.error(`Non-JSON response from report creation: ${createText.slice(0, 200)}`);
        process.exit(1);
      }
      const reportId = report.report_id;
      console.error(`Created report ${reportId}  status=${report.status}`);

      if (!opts.wait && !opts.download) return;

      const status = await pollUntilDone(reportId, token, opts.verbose);
      if (status !== 'DONE') {
        console.error(`Report ended with status: ${status}`);
        process.exit(1);
      }

      if (!opts.download) return;

      const dl = await apiFetch(`/v4/reports/${reportId}/download`, token, { verbose: opts.verbose });
      if (!dl.ok) {
        console.error(`Download failed ${dl.status}`);
        process.exit(1);
      }
      const text = await dl.text();
      printJsonText(text, opts);
    });

  addGlobalOptions(runCmd, {
    examples: [
      'extole reports run --type summary --days 30 --download',
      'extole reports run --type summary_per_program --days 7 --wait',
    ],
  });

  const describeCmd = new Command('describe')
    .description('Show parameters for a report type')
    .allowExcessArguments(false)
    .option('--type <type>', 'Report type to describe')
    .action(async function () {
      const opts = this.optsWithGlobals();
      if (!opts.type) {
        console.error('Error: --type REPORT_TYPE is required. Run `extole reports types` to see available types.');
        process.exit(2);
      }
      const token = resolveToken(opts);
      const data = await apiJson(`/v6/report-types/${encodeURIComponent(opts.type)}`, token, { verbose: opts.verbose });

      if (opts.json) {
        printJson(data, opts);
        return;
      }

      console.log(`${data.display_name || data.name}`);
      if (data.description) {
        const desc = data.description.replace(/<[^>]+>/g, '').trim();
        if (desc) console.log(desc);
      }
      console.log(`executor: ${data.executor_type}   formats: ${(data.formats || []).join(', ')}`);
      console.log();

      if (!data.parameters?.length) {
        console.log('No parameters defined.');
        return;
      }

      const required = data.parameters.filter(p => p.is_required);
      const optional = data.parameters.filter(p => !p.is_required);

      const printParam = (p) => {
        const req = p.is_required ? ' (required)' : '';
        const def = p.default_value != null ? `  default: ${p.default_value}` : '';
        const vals = p.type?.values?.length ? `\n    values: ${p.type.values.join(', ')}` : '';
        console.log(`  ${p.name}${req}  [${p.type?.name || 'STRING'}]${def}${vals}`);
      };

      if (required.length) {
        console.log('Required:');
        required.forEach(printParam);
      }
      if (optional.length) {
        console.log('\nOptional:');
        optional.forEach(printParam);
      }
    });

  addGlobalOptions(describeCmd, {
    output: true,
    examples: [
      'extole reports describe --type summary',
      'extole reports describe --type ADVOCATE_LIST',
    ],
  });

  const statusCmd = new Command('status')
    .description('Check the status of a report')
    .allowExcessArguments(false)
    .argument('<report_id>', 'Report ID to check')
    .action(async function(reportId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const report = await apiJson(`/v4/reports/${reportId}`, token, { verbose: opts.verbose });
      if (opts.json) {
        printJson(report, opts);
        return;
      }
      console.log(`report_id  ${report.report_id}`);
      console.log(`status     ${report.status}`);
      if (report.report_type) console.log(`type       ${report.report_type}`);
      if (report.created_at) console.log(`created    ${formatEventDate(report.created_at)}`);
    });

  addGlobalOptions(statusCmd, {
    output: true,
    examples: ['extole reports status REPORT_ID'],
  });

  const downloadCmd = new Command('download')
    .description('Download results of a completed report')
    .allowExcessArguments(false)
    .argument('<report_id>', 'Report ID to download')
    .option('--wait', 'Poll until complete before downloading')
    .action(async function(reportId) {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);

      if (opts.wait) {
        const status = await pollUntilDone(reportId, token, opts.verbose);
        if (status === 'FAILED') {
          console.error('Report failed.');
          process.exit(1);
        }
      }

      const dl = await apiFetch(`/v4/reports/${reportId}/download`, token, { verbose: opts.verbose });
      if (!dl.ok) {
        console.error(`Download failed ${dl.status}`);
        process.exit(1);
      }
      const text = await dl.text();
      printJsonText(text, opts);
    });

  addGlobalOptions(downloadCmd, {
    output: true,
    examples: [
      'extole reports download REPORT_ID',
      'extole reports download REPORT_ID --wait',
    ],
  });

  reports.addCommand(typesCmd);
  reports.addCommand(recommendedCmd);
  reports.addCommand(describeCmd);
  reports.addCommand(runCmd);
  reports.addCommand(statusCmd);
  reports.addCommand(downloadCmd);
  return reports;
}
