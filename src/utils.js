import { Option } from 'commander';
import { getDefaultAccount } from './config.js';

const _defaultAccount = getDefaultAccount();

export function collect(val, prev) {
  return prev.concat([val]);
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export const SEEN_MAX_SIZE = 5000;
export const SEEN_KEEP_SIZE = 4000;

export function logRequest(verbose, method, url, { headers = {}, body = null } = {}) {
  if (!verbose) return;
  const lines = [`→ ${method} ${url}`];
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'authorization') {
      const masked = v.length > 20 ? v.slice(0, 6) + '...' + v.slice(-4) : '***';
      lines.push(`  ${k}: ${masked}`);
    } else {
      lines.push(`  ${k}: ${v}`);
    }
  }
  if (body) lines.push(`  ${body}`);
  process.stderr.write(lines.join('\n') + '\n');
}

/**
 * Attach standard global options to any Command.
 * - Always adds: --token, --profile (hidden from default Options block)
 * - output: true → also adds --json, --compact (hidden)
 * - examples: string[] → appended as an Examples section
 * All hidden options are surfaced in labeled sections via addHelpText.
 */
export function addGlobalOptions(cmd, { output = false, examples = [] } = {}) {
  cmd
    .addOption(
      new Option('--token <token>', 'Override token for this call')
        .env('EXTOLE_TOKEN')
        .hideHelp()
    )
    .addOption(
      new Option('--account <name>', 'Saved account name')
        .default(_defaultAccount)
        .env('EXTOLE_ACCOUNT')
        .hideHelp()
    );

  cmd.addOption(new Option('--verbose', 'Log each HTTP request to stderr').hideHelp());

  if (output) {
    cmd
      .addOption(new Option('--json', 'Emit raw JSON').hideHelp())
      .addOption(new Option('--compact', 'Strip nulls and empty fields').hideHelp());
  }

  const sections = [];

  if (output) {
    sections.push(
      '\nOutput Options:\n' +
      '  --json               Emit raw JSON\n' +
      '  --compact            Strip nulls and empty fields'
    );
  }

  const accountDesc = _defaultAccount
    ? `Saved account name (default: "${_defaultAccount}", or set EXTOLE_ACCOUNT)`
    : 'Saved account name (or set EXTOLE_ACCOUNT)';
  sections.push(
    '\nGlobal Options:\n' +
    '  --token <token>      Override token (or set EXTOLE_TOKEN)\n' +
    `  --account <name>     ${accountDesc}\n` +
    '  --verbose            Log each HTTP request to stderr'
  );

  if (examples.length > 0) {
    sections.push('\nExamples:\n' + examples.map(e => `  ${e}`).join('\n'));
  }

  cmd.addHelpText('after', sections.join('\n'));
  return cmd;
}
