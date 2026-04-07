import { Command } from 'commander';
import { resolveToken, PERSON_BASE } from '../config.js';
import { printJson } from '../output.js';
import { addGlobalOptions, logRequest } from '../utils.js';

// TODO: replace with /v4/programs once the v4 endpoint bug is fixed
async function fetchPrograms(token, verbose = false) {
  const { default: fetch } = await import('node-fetch');
  logRequest(verbose, 'GET', `${PERSON_BASE}/v2/campaign-summaries`);
  const res = await fetch(`${PERSON_BASE}/v2/campaign-summaries`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`API error ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function groupPrograms(campaigns) {
  const filtered = campaigns.filter(
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
          campaigns: camps.map(c => ({
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
