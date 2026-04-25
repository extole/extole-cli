import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';

// TODO: replace with /v4/programs once the v4 endpoint bug is fixed
async function fetchPrograms(token, verbose) {
  return apiJson('/v2/campaign-summaries', token, { verbose, baseUrl: API_BASE });
}

function groupPrograms(campaigns) {
  const list = Array.isArray(campaigns) ? campaigns : (campaigns?.campaigns || []);
  const filtered = list.filter(
    c => c.campaign_type === 'MARKETING' && c.state !== 'ARCHIVED'
  );
  const groups = {};
  for (const c of filtered) {
    const label = c.program_label || '(unlabeled)';
    if (!groups[label]) groups[label] = [];
    groups[label].push(c);
  }
  return groups;
}

export function programsCommand() {
  const cmd = new Command('programs')
    .description('List programs and their campaigns')
    .option('--all', 'Include NOT_LAUNCHED campaigns (default: LIVE only)')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const campaigns = await fetchPrograms(token, opts.verbose);
      const groups = groupPrograms(campaigns);

      if (opts.json) {
        const out = Object.entries(groups).map(([program_label, camps]) => ({
          program_label,
          campaigns: (opts.all ? camps : camps.filter(c => c.state === 'LIVE')).map(c => ({
            campaign_id: c.campaign_id,
            name: c.name,
            state: c.state,
            theme_name: c.theme_name,
          })),
        }));
        printJson(out, opts);
        return;
      }

      for (const [label, camps] of Object.entries(groups)) {
        const visible = opts.all ? camps : camps.filter(c => c.state === 'LIVE');
        if (visible.length === 0) continue;
        console.log(`\n${label}`);
        for (const c of visible) {
          const state = c.state === 'LIVE' ? '' : `  [${c.state}]`;
          console.log(`  ${c.name}${state}`);
          console.log(`  ${c.campaign_id}`);
        }
      }
    });

  return addGlobalOptions(cmd, {
    output: true,
    examples: [
      'extole programs',
      'extole programs --all',
      'extole programs --json',
    ],
  });
}
