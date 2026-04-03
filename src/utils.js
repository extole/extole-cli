import { Option } from 'commander';

export function collect(val, prev) {
  return prev.concat([val]);
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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
        .default('default')
        .env('EXTOLE_ACCOUNT')
        .hideHelp()
    );

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

  sections.push(
    '\nGlobal Options:\n' +
    '  --token <token>      Override token (or set EXTOLE_TOKEN)\n' +
    '  --account <name>     Saved account name (default: "default", or set EXTOLE_ACCOUNT)'
  );

  if (examples.length > 0) {
    sections.push('\nExamples:\n' + examples.map(e => `  ${e}`).join('\n'));
  }

  cmd.addHelpText('after', sections.join('\n'));
  return cmd;
}
