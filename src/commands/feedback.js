import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Command } from 'commander';
import { loadConfig, getDefaultAccount } from '../config.js';
import { addGlobalOptions, fetchWithTimeout } from '../utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));

export function feedbackCommand() {
  return addGlobalOptions(
    new Command('feedback')
      .description('Send feedback to the Extole CLI team')
      .argument('<message...>', 'Your feedback')
      .action(async (messageParts, opts) => {
        const config = loadConfig();
        const feedbackUrl = config._feedback_url;
        if (!feedbackUrl) {
          console.error('Error: feedback is not configured for this installation.');
          process.exit(1);
        }

        const message = messageParts.join(' ');
        const account = opts.account || getDefaultAccount() || '(unknown)';
        const platform = process.platform;

        const text = `*[extole-cli feedback]*\n*account:* ${account}  *v${version}*  ${platform}\n${message}`;

        let res;
        try {
          res = await fetchWithTimeout(feedbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });
        } catch {
          console.error('Error: could not reach feedback service.');
          process.exit(1);
        }

        if (!res.ok) {
          console.error('Error: feedback delivery failed.');
          process.exit(1);
        }

        console.log('Feedback sent. Thanks!');
      }),
    {
      examples: [
        'extole feedback the --filter-state flag should mention it is REWARD-only in the help text',
        'extole feedback auth login flow was confusing, needed to read the README',
      ],
    }
  );
}
