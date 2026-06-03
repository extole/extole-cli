import { Command } from 'commander';
import { resolveToken, API_BASE } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';

// TODO: replace with /v4/programs once the v4 endpoint bug is fixed
async function fetchPrograms(token, verbose) {
  return apiJson('/v2/campaign-summaries', token, { verbose, baseUrl: API_BASE });
}

export function programsCommand() {
  const cmd = new Command('programs')
    .description('List campaigns. Shows all types by default; filter with --type.')
    .option('--all', 'Include NOT_LAUNCHED campaigns (default: LIVE only)')
    .option('--type <type>', 'Filter by campaign type (e.g. MARKETING, INTEGRATION, EXTENSION)')
    .action(async (opts) => {
      const token = resolveToken(opts);
      const raw = await fetchPrograms(token, opts.verbose);
      const list = Array.isArray(raw) ? raw : (raw?.campaigns || []);

      let rows = list.filter(c => c.state !== 'ARCHIVED');
      if (!opts.all) rows = rows.filter(c => c.state === 'LIVE');
      if (opts.type) rows = rows.filter(c => (c.campaign_type || '').toUpperCase() === opts.type.toUpperCase());

      rows.sort((a, b) => {
        const ta = a.campaign_type || '';
        const tb = b.campaign_type || '';
        if (ta !== tb) return ta.localeCompare(tb);
        const na = (a.program_label || a.name || '').toLowerCase();
        const nb = (b.program_label || b.name || '').toLowerCase();
        return na.localeCompare(nb);
      });

      if (opts.json) {
        printJson(rows.map(c => ({
          campaign_id: c.campaign_id,
          name: c.name,
          program_label: c.program_label,
          campaign_type: c.campaign_type,
          state: c.state,
          theme_name: c.theme_name,
        })), opts);
        return;
      }

      if (rows.length === 0) {
        console.log('No campaigns found.');
        return;
      }

      const nameCol = rows.map(c => (c.program_label || c.name || '').length);
      const typeCol = rows.map(c => (c.campaign_type || '').length);
      const stateCol = rows.map(c => (c.state || '').length);
      const nameW = Math.max(4, ...nameCol);
      const typeW = Math.max(4, ...typeCol);
      const stateW = Math.max(5, ...stateCol);

      const line = (n, t, s, id) =>
        `${n.padEnd(nameW)}  ${t.padEnd(typeW)}  ${s.padEnd(stateW)}  ${id}`;

      console.log(line('NAME', 'TYPE', 'STATE', 'CAMPAIGN ID'));
      console.log(`${'─'.repeat(nameW)}  ${'─'.repeat(typeW)}  ${'─'.repeat(stateW)}  ${'─'.repeat(22)}`);
      for (const c of rows) {
        console.log(line(
          c.program_label || c.name || '',
          c.campaign_type || '',
          c.state || '',
          c.campaign_id,
        ));
      }
    });

  cmd._mcpDescription = 'List all campaigns on the account. Returns campaign_id, name, and status. campaign_id is the key input for campaigns_reward-rules, campaigns_maxmind, campaigns_quality-rules, and webhooks_attach. Use to discover campaign IDs when you only have a name.';

  return addGlobalOptions(cmd, {
    output: true,
    examples: [
      'extole programs',
      'extole programs --all',
      'extole programs --type integration',
      'extole programs --type marketing --all',
      'extole programs --json',
    ],
  });
}
