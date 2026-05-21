import { Command } from 'commander';
import { buildTools, toMcpTool } from '../schema.js';

export function schemaCommand(program) {
  return new Command('schema')
    .description('Print all CLI commands as an MCP-compatible JSON tool schema')
    .allowExcessArguments(false)
    .option('--all', 'Include tools excluded from serve mode (streaming/interactive)')
    .addHelpText('after', `
Examples:
  extole schema
  extole schema --all
  extole schema | jq 'length'`)
    .action(function () {
      const { all } = this.opts();
      const tools = buildTools(program)
        .filter(t => all || !t._excluded)
        .map(toMcpTool);
      process.stdout.write(JSON.stringify(tools, null, 2) + '\n');
    });
}
