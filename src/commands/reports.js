import { Command } from 'commander';
import { resolveToken } from '../config.js';
import { apiJson, apiFetch } from '../api.js';
import { printJson, printJsonText } from '../output.js';

export function reportsCommand() {
  const reports = new Command('reports');

  reports
    .command('list')
    .description('List available report runners')
    .option('--json', 'Emit JSON')
    .option('--compact', 'Strip nulls and empty fields from JSON output')
    .option('--token <token>', 'Override token')
    .option('--profile <profile>', 'Profile name', 'default')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const data = await apiJson('/v7/report-runners', token);
      const runners = Array.isArray(data) ? data : (data.runners || []);
      if (opts.json) {
        printJson(runners, opts);
        return;
      }
      const col1 = Math.max(20, ...runners.map(r => (r.runner_id || r.id || '').length)) + 2;
      console.log('runner_id'.padEnd(col1) + 'display_name');
      console.log('─'.repeat(col1) + '─'.repeat(40));
      for (const r of runners) {
        const id = (r.runner_id || r.id || '').padEnd(col1);
        console.log(`${id}${r.display_name || r.name || ''}`);
      }
    });

  reports
    .command('types')
    .description('List available report types')
    .option('--json', 'Emit JSON')
    .option('--compact', 'Strip nulls and empty fields from JSON output')
    .option('--token <token>', 'Override token')
    .option('--profile <profile>', 'Profile name', 'default')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const data = await apiJson('/v4/report-types', token);
      const types = Array.isArray(data) ? data : (data.report_types || []);
      if (opts.json) {
        printJson(types, opts);
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

  reports
    .command('run')
    .description('Create an on-demand report')
    .requiredOption('--type <report_type>', 'Report type (e.g. summary, summary_per_program)')
    .option('-p, --param <kv>', 'key=value parameter (repeatable)', collect, [])
    .option('--days <n>', 'Shortcut: set time_range to last N days')
    .option('--wait', 'Poll until report is complete')
    .option('--download', 'Download and print result (implies --wait)')
    .option('--verbose', 'Full output without compaction')
    .option('--token <token>', 'Override token')
    .option('--profile <profile>', 'Profile name', 'default')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const parameters = {};
      for (const kv of opts.param) {
        const idx = kv.indexOf('=');
        if (idx < 0) { console.error(`Invalid param (expected key=value): ${kv}`); process.exit(2); }
        parameters[kv.slice(0, idx)] = kv.slice(idx + 1);
      }
      if (opts.days && !parameters.time_range) {
        const end = new Date();
        const start = new Date(end.getTime() - parseInt(opts.days) * 86400 * 1000);
        parameters.time_range = `${start.toISOString()}/${end.toISOString()}`;
      }

      // Create report
      const body = { report_type: opts.type, parameters };
      const createRes = await apiFetch('/v4/reports', token, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const createText = await createRes.text();
      if (!createRes.ok) {
        console.error(`Create failed ${createRes.status}: ${createText.slice(0, 300)}`);
        process.exit(1);
      }
      const report = JSON.parse(createText);
      const reportId = report.report_id;
      console.error(`Created report ${reportId}  status=${report.status}`);

      if (!opts.wait && !opts.download) return;

      // Poll until done
      const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
      let frame = 0;
      let status = report.status;
      while (status !== 'DONE' && status !== 'FAILED') {
        await sleep(1500);
        const poll = await apiJson(`/v4/reports/${reportId}`, token);
        status = poll.status;
        process.stderr.write(`\r${frames[frame++ % frames.length]}  ${status}    `);
      }
      process.stderr.write('\r\x1b[K');

      if (status === 'FAILED') {
        console.error('Report failed.');
        process.exit(1);
      }

      if (!opts.download) return;

      // Download
      const dl = await apiFetch(`/v4/reports/${reportId}/download`, token);
      if (!dl.ok) {
        console.error(`Download failed ${dl.status}`);
        process.exit(1);
      }
      const text = await dl.text();
      printJsonText(text, opts);
    });

  return reports;
}

function collect(val, prev) {
  return prev.concat([val]);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
