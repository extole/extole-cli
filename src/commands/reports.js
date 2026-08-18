import { Command } from 'commander';
import { pipeline } from 'node:stream/promises';
import { resolveToken } from '../config.js';
import { apiJson, apiFetch } from '../api.js';
import { printJson } from '../output.js';
import { collect, sleep, addGlobalOptions, formatEventDate } from '../utils.js';

const REPORT_POLL_MAX_ATTEMPTS = 800; // 800 attempts × 1.5s = 20 minutes (Spark ALL_TIME reports can take 10+ min)
const TERMINAL_STATES = new Set(['DONE', 'FAILED', 'CANCELLED', 'EXPIRED']);

export async function pollUntilDone(reportId, token, verbose) {
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
    .action(async (options) => {
      const token = resolveToken(options);
      const data = await apiJson('/v7/report-runners', token, { verbose: options.verbose });
      const runners = Array.isArray(data) ? data : (data.runners || []);
      if (options.json) {
        printJson(runners, options);
        return;
      }
      if (runners.length === 0) { console.log('No report runners found.'); return; }
      const idColumnWidth = Math.max(20, ...runners.map(runner => (runner.runner_id || runner.id || '').length)) + 2;
      console.log('runner_id'.padEnd(idColumnWidth) + 'display_name');
      console.log('─'.repeat(idColumnWidth) + '─'.repeat(40));
      for (const runner of runners) {
        console.log(`${(runner.runner_id || runner.id || '').padEnd(idColumnWidth)}${runner.display_name || runner.name || ''}`);
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
      const options = this.optsWithGlobals();
      const token = resolveToken(options);
      const data = await apiJson('/v6/report-types', token, { verbose: options.verbose });
      let reportTypes = Array.isArray(data) ? data : (data.report_types || []);

      if (options.filter) {
        const needle = options.filter.toLowerCase();
        reportTypes = reportTypes.filter(reportType => {
          const haystack = [
            reportType.report_type, reportType.name, reportType.display_name, reportType.description,
            ...(reportType.categories || []),
          ].filter(Boolean).join(' ').toLowerCase();
          return haystack.includes(needle);
        });
      }

      if (options.json) {
        printJson(reportTypes, options);
        return;
      }
      if (reportTypes.length === 0) {
        console.log(options.filter
          ? `No report types match "${options.filter}".`
          : 'No report types found.');
        return;
      }
      const typeColumnWidth = Math.max(20, ...reportTypes.map(reportType => (reportType.report_type || reportType.name || '').length)) + 2;
      const nameColumnWidth = 35;
      console.log('report_type'.padEnd(typeColumnWidth) + 'display_name'.padEnd(nameColumnWidth) + 'executor_type');
      console.log('─'.repeat(typeColumnWidth) + '─'.repeat(nameColumnWidth) + '─'.repeat(20));
      for (const reportType of reportTypes) {
        const id = (reportType.report_type || reportType.name || '').padEnd(typeColumnWidth);
        const name = (reportType.display_name || '').slice(0, nameColumnWidth - 2).padEnd(nameColumnWidth);
        console.log(`${id}${name}${reportType.executor_type || ''}`);
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
      const options = this.optsWithGlobals();
      const token = resolveToken(options);
      const queryString = options.limit ? `?limit=${encodeURIComponent(options.limit)}` : '';
      const data = await apiJson(`/v6/report-types/recommendations${queryString}`, token, { verbose: options.verbose });
      const recommendations = Array.isArray(data) ? data : (data.report_types || []);

      if (options.json) {
        printJson(recommendations, options);
        return;
      }
      if (recommendations.length === 0) {
        console.log('No recommendations available.');
        return;
      }

      console.log(`Recommended report types (${recommendations.length}):\n`);
      const stripHtml = (text) => (text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const wrap = (text, width, indent) => {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        for (const word of words) {
          if ((currentLine + ' ' + word).trim().length > width) {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = currentLine ? `${currentLine} ${word}` : word;
          }
        }
        if (currentLine) lines.push(currentLine);
        return lines.map(line => `${indent}${line}`).join('\n');
      };

      for (const recommendation of recommendations) {
        const id = recommendation.report_type || recommendation.name || '';
        const display = recommendation.display_name || '';
        const cats = (recommendation.categories && recommendation.categories.length) ? `  [${recommendation.categories.join(', ')}]` : '';
        console.log(`  ${id}    ${display}${cats}`);
        const desc = stripHtml(recommendation.description);
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
    .option('--format <fmt>', 'Output format: JSON, JSONL, CSV (see `reports describe --type <t>`)')
    .option('--scope <scope>', 'Visibility scope: CLIENT_SUPERUSER (hidden from client), CLIENT_ADMIN (default visible)', collect, [])
    .option('--wait', 'Poll until report is complete')
    .option('--download', 'Download and print result (implies --wait)')
    .action(async function () {
      const options = this.optsWithGlobals();
      if (!options.type) {
        console.error('Error: --type REPORT_TYPE is required. Run `extole reports types` to see available types.');
        process.exit(2);
      }
      const token = resolveToken(options);
      const parameters = {};
      for (const keyValue of options.param) {
        const separatorIndex = keyValue.indexOf('=');
        if (separatorIndex < 0) { console.error(`Invalid param (expected key=value): ${keyValue}`); process.exit(2); }
        parameters[keyValue.slice(0, separatorIndex)] = keyValue.slice(separatorIndex + 1);
      }
      if (options.days && parameters.time_range) {
        console.error('Error: --days and -p time_range are mutually exclusive.');
        process.exit(2);
      }
      if (options.days && !parameters.time_range) {
        const days = parseInt(options.days, 10);
        if (isNaN(days) || days <= 0) {
          console.error('--days must be a positive integer');
          process.exit(2);
        }
        const end = new Date();
        const start = new Date(end.getTime() - days * 86400 * 1000);
        parameters.time_range = `${start.toISOString()}/${end.toISOString()}`;
      }

      const body = { report_type: options.type, parameters };
      if (options.format) body.formats = [options.format.toUpperCase()];
      if (options.scope && options.scope.length > 0) body.scopes = options.scope.map(scope => scope.toUpperCase());
      const createResponse = await apiFetch('/v4/reports', token, {
        method: 'POST',
        body: JSON.stringify(body),
        verbose: options.verbose,
      });
      const createText = await createResponse.text();
      if (!createResponse.ok) {
        console.error(`Create failed ${createResponse.status}: ${createText.slice(0, 300)}`);
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

      if (!options.wait && !options.download) return;

      const status = await pollUntilDone(reportId, token, options.verbose);
      if (status !== 'DONE') {
        console.error(`Report ended with status: ${status}`);
        process.exit(1);
      }

      if (!options.download) return;

      const downloadResponse = await apiFetch(`/v4/reports/${reportId}/download`, token, { verbose: options.verbose, headers: { Accept: '*/*' } });
      if (!downloadResponse.ok) {
        console.error(`Download failed ${downloadResponse.status}`);
        process.exit(1);
      }
      await pipeline(downloadResponse.body, process.stdout);
    });

  addGlobalOptions(runCmd, {
    examples: [
      'extole reports run --type summary --days 30 --download',
      'extole reports run --type FUNNEL_RATES -p time_range=ALL_TIME -p period=WEEK --scope CLIENT_SUPERUSER --download',
      'extole reports run --type summary_per_program --days 7 --wait',
      'extole reports run --type summary --days 7 --format jsonl --download | jq -c .',
    ],
  });

  const describeCmd = new Command('describe')
    .description('Show parameters for a report type')
    .allowExcessArguments(false)
    .option('--type <type>', 'Report type to describe')
    .action(async function () {
      const options = this.optsWithGlobals();
      if (!options.type) {
        console.error('Error: --type REPORT_TYPE is required. Run `extole reports types` to see available types.');
        process.exit(2);
      }
      const token = resolveToken(options);
      const data = await apiJson(`/v6/report-types/${encodeURIComponent(options.type)}`, token, { verbose: options.verbose });

      if (options.json) {
        printJson(data, options);
        return;
      }

      console.log(`${data.display_name || data.name}`);
      if (data.description) {
        const description = data.description.replace(/<[^>]+>/g, '').trim();
        if (description) console.log(description);
      }
      console.log(`executor: ${data.executor_type}   formats: ${(data.formats || []).join(', ')}`);
      console.log();

      if (!data.parameters?.length) {
        console.log('No parameters defined.');
        return;
      }

      const requiredParams = data.parameters.filter(param => param.is_required);
      const optionalParams = data.parameters.filter(param => !param.is_required);

      const printParam = (param) => {
        const required = param.is_required ? ' (required)' : '';
        const defaultValue = param.default_value != null ? `  default: ${param.default_value}` : '';
        const allowedValues = param.type?.values?.length ? `\n    values: ${param.type.values.join(', ')}` : '';
        console.log(`  ${param.name}${required}  [${param.type?.name || 'STRING'}]${defaultValue}${allowedValues}`);
      };

      if (requiredParams.length) {
        console.log('Required:');
        requiredParams.forEach(printParam);
      }
      if (optionalParams.length) {
        console.log('\nOptional:');
        optionalParams.forEach(printParam);
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
      const options = this.optsWithGlobals();
      const token = resolveToken(options);
      const report = await apiJson(`/v4/reports/${reportId}`, token, { verbose: options.verbose });
      if (options.json) {
        printJson(report, options);
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
      const options = this.optsWithGlobals();
      const token = resolveToken(options);

      if (options.wait) {
        const status = await pollUntilDone(reportId, token, options.verbose);
        if (status === 'FAILED') {
          console.error('Report failed.');
          process.exit(1);
        }
      }

      const downloadResponse = await apiFetch(`/v4/reports/${reportId}/download`, token, { verbose: options.verbose, headers: { Accept: '*/*' } });
      if (!downloadResponse.ok) {
        console.error(`Download failed ${downloadResponse.status}`);
        process.exit(1);
      }
      await pipeline(downloadResponse.body, process.stdout);
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
