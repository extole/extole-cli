import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Command } from 'commander';
import { resolveToken } from '../config.js';
import { addGlobalOptions } from '../utils.js';
import { sendToAgent } from './chat.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));

export function feedbackCommand() {
  return addGlobalOptions(
    new Command('feedback')
      .description('Send feedback or report a bug to the Extole CLI team (creates a Jira ticket via Extole AI)')
      .argument('<message...>', 'Your feedback or bug description')
      .action(async function (messageParts) {
        const options = this.optsWithGlobals();
        const token = resolveToken(options);
        const message = messageParts.join(' ');
        const prompt = `please log a jira issue: ${message} — cli v${version} ${process.platform}${options.account ? ` account:${options.account}` : ''}`;
        try {
          const reply = await sendToAgent(prompt, token);
          console.log(reply);
        } catch (error) {
          console.error(`Error: ${error.message}`);
          process.exit(1);
        }
      }),
    {
      examples: [
        'extole feedback the --filter-state flag should mention it is REWARD-only in the help text',
        'extole feedback auth login flow was confusing, needed to read the README',
      ],
    }
  );
}
