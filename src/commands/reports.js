import { Command } from 'commander';
import { resolveToken } from '../config.js';
import { apiJson, apiFetch } from '../api.js';

export function reportsCommand() {
  const reports = new Command('reports');

  reports
    .command('list')
    .description('List available report runners')
    .option('--json', 'Emit raw JSON')
    .option('--token <token>', 'Override token')
    .option('--profile <profile>', 'Profile name', 'default')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const data = await apiJson('/v4/report-runners', token);
      const runners = Array.isArray(data) ? data : (data.runners || []);
      if (opts.json) {
        process.stdout.write(JSON.stringify(runners, null, 2) + '\n');
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
    .option('--json', 'Emit raw JSON')
    .option('--token <token>', 'Override token')
    .option('--profile <profile>', 'Profile name', 'default')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const data = await apiJson('/v4/report-types', token);
      const types = Array.isArray(data) ? data : (data.report_types || []);
      if (opts.json) {
        process.stdout.write(JSON.stringify(types, null, 2) + '\n');
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
    .option('--wait', 'Poll until report is complete')
    .option('--download', 'Download and print result (implies --wait)')
    .option('--json', 'Emit raw API response')
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
      if (!opts.json) console.error(`Created report ${reportId}  status=${report.status}`);
      else process.stderr.write(JSON.stringify(report) + '\n');

      if (!opts.wait && !opts.download) return;

      // Poll until done
      let status = report.status;
      while (status !== 'DONE' && status !== 'FAILED') {
        await sleep(2000);
        const poll = await apiJson(`/v4/reports/${reportId}`, token);
        status = poll.status;
        if (!opts.json) process.stderr.write(`  polling... ${status}\r`);
      }
      if (!opts.json) process.stderr.write('\n');

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
      process.stdout.write(text + '\n');
    });

  return reports;
}

function collect(val, prev) {
  return prev.concat([val]);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
