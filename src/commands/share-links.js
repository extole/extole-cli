import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions, isValidEmail } from '../utils.js';
import { findPerson } from '../person-api.js';

export function shareLinksCommand() {
  const cmd = new Command('share-links')
    .description('Look up share links by email')
    .allowExcessArguments(false)
    .option('--email <email>', 'Email address to look up')
    .option('--label <label>', 'Filter by label')
    .action(async (opts) => {
      if (!opts.email) {
        console.error('Error: --email <email> is required.');
        process.exit(2);
      }
      if (!isValidEmail(opts.email)) {
        console.error('Error: --email must be a valid email address.');
        process.exit(2);
      }

      const token = resolveToken(opts);
      const match = await findPerson(opts.email, token, opts.verbose);
      if (!match) {
        console.error(`No person found for ${opts.email}`);
        process.exit(1);
      }

      const all = await apiJson(`/v5/persons/${match.id}/shareables`, token, { verbose: opts.verbose, baseUrl: API_BASE });

      if (!Array.isArray(all) || all.length === 0) {
        console.error(`No share links found for ${opts.email} (person ID: ${match.id})`);
        return;
      }

      const links = opts.label
        ? all.filter(s => s.label === opts.label || s.key === opts.label)
        : all;

      if (links.length === 0) {
        console.error(`No share links found for ${opts.email} with label=${opts.label}`);
        return;
      }

      if (opts.json) {
        printJson(links, opts);
        return;
      }

      const labelW = Math.max(5, ...links.map(s => (s.label || '').length));
      const codeW  = Math.max(4, ...links.map(s => (s.code  || '').length));

      console.log(
        'label'.padEnd(labelW) + '  ' +
        'code'.padEnd(codeW)   + '  ' +
        'link'
      );
      console.log('─'.repeat(labelW) + '  ' + '─'.repeat(codeW) + '  ' + '─'.repeat(40));

      for (const s of links) {
        console.log(
          (s.label || '').padEnd(labelW) + '  ' +
          (s.code  || '').padEnd(codeW)  + '  ' +
          (s.link  || '')
        );
      }
    });

  return addGlobalOptions(cmd, {
    output: true,
    examples: [
      'extole share-links --email jane@example.com',
      'extole share-links --email jane@example.com --label credit-cards',
      'extole share-links --email jane@example.com --json',
    ],
  });
}
