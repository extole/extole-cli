import { Option } from 'commander';
import { getDefaultAccount } from './config.js';

// Cached once at module load so every command registration shares the same value
// without re-reading the config file.
const _defaultAccount = getDefaultAccount();

export async function fetchWithTimeout(url, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function collect(val, prev) {
  return prev.concat([val]);
}

// Line-based LCS diff — old/new text is expected to be a script or config blob
// (tens to low hundreds of lines), not arbitrary large files.
export function diffLines(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const n = oldLines.length, m = newLines.length;
  const lengths = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i][j] = oldLines[i] === newLines[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const hunks = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) { hunks.push({ type: 'same', line: oldLines[i] }); i++; j++; }
    else if (lengths[i + 1][j] >= lengths[i][j + 1]) { hunks.push({ type: 'del', line: oldLines[i] }); i++; }
    else { hunks.push({ type: 'add', line: newLines[j] }); j++; }
  }
  while (i < n) { hunks.push({ type: 'del', line: oldLines[i] }); i++; }
  while (j < m) { hunks.push({ type: 'add', line: newLines[j] }); j++; }
  return hunks;
}

export function printDiff(oldText, newText) {
  for (const { type, line } of diffLines(oldText, newText)) {
    if (type === 'same') console.log(`  ${line}`);
    else if (type === 'del') console.log(`- ${line}`);
    else console.log(`+ ${line}`);
  }
}

export function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export const SEEN_MAX_SIZE = 5000;
export const SEEN_KEEP_SIZE = 4000;

export const POLL_INTERVAL_MS = 2500;

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function formatEventTime(isoString) {
  return new Date(isoString).toLocaleTimeString('en-US', { hour12: false });
}

export function formatEventDate(isoString) {
  return new Date(isoString).toLocaleString('en-US', {
    month: 'numeric', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

export function logRequest(verbose, method, url, { headers = {}, body = null } = {}) {
  if (!verbose) return;
  const lines = [`→ ${method} ${url}`];
  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (headerName.toLowerCase() === 'authorization') {
      const masked = headerValue.length > 20 ? headerValue.slice(0, 6) + '...' + headerValue.slice(-4) : '***';
      lines.push(`  ${headerName}: ${masked}`);
    } else {
      lines.push(`  ${headerName}: ${headerValue}`);
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
export function addGlobalOptions(cmd, { output = false, examples = [], exitCodes = null } = {}) {
  cmd
    .addOption(
      new Option('--token <token>', 'Override token for this call')
        .env('EXTOLE_TOKEN')
        .hideHelp()
    )
    .addOption(
      new Option('--account <name>', 'Saved account name')
        .env('EXTOLE_ACCOUNT')
        .hideHelp()
    );

  cmd.addOption(new Option('--verbose', 'Log each HTTP request to stderr').hideHelp());
  cmd.addOption(new Option('--timeout <seconds>', 'Override request timeout in seconds (default: 30)').hideHelp());

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
    '  --verbose            Log each HTTP request to stderr\n' +
    '  --timeout <seconds>  Override request timeout in seconds (default: 30)'
  );

  if (exitCodes) {
    sections.push('\nExit Codes:\n  ' + exitCodes);
  }

  if (examples.length > 0) {
    sections.push('\nExamples:\n' + examples.map(example => `  ${example}`).join('\n'));
  }

  cmd.addHelpText('after', sections.join('\n'));
  return cmd;
}
