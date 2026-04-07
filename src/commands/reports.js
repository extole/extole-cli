import { Command } from 'commander';
import { resolveToken } from '../config.js';
import { apiJson, apiFetch } from '../api.js';
import { printJson, printJsonText } from '../output.js';
import { collect, sleep, addGlobalOptions } from '../utils.js';

const REPORT_POLL_MAX = 240; // 6 minutes at 1.5s intervals

export function reportsCommand() {
  const reports = new Command('reports').description('List report types and run on-demand reports');

  const listCmd = new Command('list')
    .description('List available report runners')
    .allowExcessArguments(false)
    .action(async (opts) => {
      const token = resolveToken(opts);
      const data = await apiJson('/v7/report-runners', token, { verbose: opts.verbose });
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

  addGlobalOptions(listCmd, { output: true });

  const typesCmd = new Command('types')
    .description('List available report types')
    .allowExcessArguments(false)
    .action(async (opts) => {
      const token = resolveToken(opts);
      const data = await apiJson('/v4/report-types', token, { verbose: opts.verbose });
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

  addGlobalOptions(typesCmd, { output: true });

  const runCmd = new Command('run')
    .description('Create an on-demand report')
    .allowExcessArguments(false)
    .option('--type <type>', 'Report type (e.g. summary, summary_per_program)')
    .option('-p, --param <kv>', 'key=value parameter (repeatable)', collect, [])
    .option('--days <n>', 'Shortcut: set time_range to last N days')
    .option('--wait', 'Poll until report is complete')
    .option('--download', 'Download and print result (implies --wait)')
    .action(async (opts) => {
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

      const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
      let frame = 0;
      let status = report.status;
      let pollAttempts = 0;
      while (status !== 'DONE' && status !== 'FAILED') {
        if (++pollAttempts > REPORT_POLL_MAX) {
          process.stderr.write('\r\x1b[K');
          console.error(`Report did not complete after ${REPORT_POLL_MAX} attempts. Last status: ${status}`);
          process.exit(1);
        }
        await sleep(1500);
        const poll = await apiJson(`/v4/reports/${reportId}`, token, { verbose: opts.verbose });
        status = poll.status;
        process.stderr.write(`\r${frames[frame++ % frames.length]}  ${status}    `);
      }
      process.stderr.write('\r\x1b[K');

      if (status === 'FAILED') {
        console.error('Report failed.');
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
    .action(async (opts) => {
      if (!opts.type) {
        console.error('Error: --type REPORT_TYPE is required. Run `extole reports types` to see available types.');
        process.exit(2);
      }
      const token = resolveToken(opts);
      const data = await apiJson(`/v4/report-types/${encodeURIComponent(opts.type)}`, token, { verbose: opts.verbose });

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
      if (report.created_at) console.log(`created    ${new Date(report.created_at).toLocaleString('en-US')}`);
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
        const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
        let frame = 0;
        let status = '';
        let pollAttempts = 0;
        while (status !== 'DONE' && status !== 'FAILED') {
          if (++pollAttempts > REPORT_POLL_MAX) {
            process.stderr.write('\r\x1b[K');
            console.error(`Report did not complete after ${REPORT_POLL_MAX} attempts.`);
            process.exit(1);
          }
          await sleep(1500);
          const poll = await apiJson(`/v4/reports/${reportId}`, token, { verbose: opts.verbose });
          status = poll.status;
          process.stderr.write(`\r${frames[frame++ % frames.length]}  ${status}    `);
        }
        process.stderr.write('\r\x1b[K');
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

  reports.addCommand(listCmd);
  reports.addCommand(typesCmd);
  reports.addCommand(describeCmd);
  reports.addCommand(runCmd);
  reports.addCommand(statusCmd);
  reports.addCommand(downloadCmd);
  return reports;
}
