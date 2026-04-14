import { Command } from 'commander';
import Anthropic from '@anthropic-ai/sdk';
import { resolveToken } from '../config.js';
import { addGlobalOptions } from '../utils.js';

const MCP_URL = 'https://mcp.extole.com/toolsets/extole/mcp';
const MODEL = 'claude-sonnet-4-6';

export function mcpCommand() {
  const cmd = new Command('mcp')
    .description('Ask a question or run a task using the Extole MCP')
    .argument('<prompt...>', 'What you want to do or know')
    .action(async (promptParts, opts) => {
      const prompt = promptParts.join(' ');
      const extoleToken = resolveToken(opts);

      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        console.error('Error: ANTHROPIC_API_KEY environment variable is required');
        process.exit(1);
      }

      const client = new Anthropic({ apiKey: anthropicKey });

      const stream = client.messages.stream(
        {
          model: MODEL,
          max_tokens: 8096,
          tools: [
            {
              type: 'mcp',
              server_label: 'extole',
              server_url: MCP_URL,
              headers: { Authorization: `Bearer ${extoleToken}` },
            },
          ],
          messages: [{ role: 'user', content: prompt }],
        },
        {
          headers: { 'anthropic-beta': 'mcp-client-2025-04-04' },
        }
      );

      stream.on('text', (text) => process.stdout.write(text));

      await stream.finalMessage();
      process.stdout.write('\n');
    });

  addGlobalOptions(cmd, {
    examples: [
      "extole mcp why aren't events firing for customer@example.com",
      'extole mcp list available programs for this client',
      'extole mcp "set up the SFDC tooling credential for org extoleapex"',
    ],
  });

  return cmd;
}
