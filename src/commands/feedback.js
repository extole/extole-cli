import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';
import { Command } from 'commander';
import { getMcpToken } from '../config.js';
import { addGlobalOptions } from '../utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));

export function feedbackCommand() {
  return addGlobalOptions(
    new Command('feedback')
      .description('Send feedback or report a bug to the Extole CLI team (creates a Jira ticket via Extole MCP)')
      .argument('<message...>', 'Your feedback or bug description')
      .action(async function (messageParts) {
        const opts = this.optsWithGlobals();
        const message = messageParts.join(' ');
        const extoleBin = process.argv[1];

        // Ensure MCP token exists — trigger mcp-login if not
        const token = await getMcpToken();
        if (!token) {
          const login = spawnSync(process.execPath, [extoleBin, 'auth', 'mcp-login'], { stdio: 'inherit' });
          if (login.status !== 0) {
            console.error('Error: login failed or was cancelled.');
            process.exit(1);
          }
        }

        const prompt = `please log a jira issue: ${message} — cli v${version} ${process.platform}${opts.account ? ` account:${opts.account}` : ''}`;
        const result = spawnSync(process.execPath, [extoleBin, 'mcp', prompt], { stdio: 'inherit' });
        process.exit(result.status ?? 0);
      }),
    {
      examples: [
        'extole feedback the --filter-state flag should mention it is REWARD-only in the help text',
        'extole feedback auth login flow was confusing, needed to read the README',
      ],
    }
  );
}
