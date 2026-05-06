import { Command } from 'commander';
import { resolveToken, API_BASE, getDefaultAccount } from '../config.js';
import { apiJson } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';

const EXCLUDE_ZONES = new Set([
  'conversion', 'registration', 'convert', 'register',
  'share_destination', 'share_destination_facebook', 'friend_cta_facebook',
  'promote_destination', 'friend_landing_coupon', 'friend_landing_experience',
  'terms', 'terms_and_conditions', 'optout', 'opt_out', 'campaign_image',
  'advocate_widget', 'advocate_widget_mobile', 'share_experience',
  'secret_destination', 'campaign_hero', 'friend_landing_reward',
  'advocate_landing_page', 'advocate_mobile_experience', 'advocate_stats',
  'share_link', 'social_share_window', 'microsite', 'microsite1', 'page',
  'robots_txt', 'page_non_redirect', 'default',
  'friend_landing_experience_microsite', 'advocate_gift_card_configuration',
  'friend_gift_card_configuration',
]);

function extractZoneNames(campaigns) {
  const zones = new Set();
  for (const campaign of campaigns) {
    for (const step of (campaign.steps || [])) {
      if (step.enabled === false) continue;
      for (const trigger of (step.triggers || [])) {
        if (trigger.trigger_phase !== 'MATCHING') continue;
        const name = trigger.trigger_name;
        if (!name || EXCLUDE_ZONES.has(name)) continue;
        for (const action of (step.actions || [])) {
          if (action.classification === 'JAVASCRIPT') {
            zones.add(name);
            break;
          }
        }
      }
    }
  }
  return [...zones].sort();
}

function buildZoneTag(zoneName) {
  const zoneId = `extole_zone_${zoneName}`;
  const params = ['email', 'first_name', 'last_name', 'partner_user_id'];
  const dataLines = params
    .map(p => `            "${p}": REPLACE_WITH_DATA_BEFORE_ADDING_TAG_TO_PAGE`)
    .join(',\n');
  return [
    `<span id="${zoneId}"></span>`,
    `<script type="text/javascript">`,
    `    (function(c,b,f,k,a){c[b]=c[b]||{};for(c[b].q=c[b].q||[];a<k.length;)f(k[a++],c[b])})(window,`,
    `    "extole",function (c,b){b[c]=b[c]||function (){b.q.push([c,arguments])}},["createZone"],0);`,
    `    extole.createZone({`,
    `        name: "${zoneName}",`,
    `        element_id: "${zoneId}",`,
    `        data: {`,
    dataLines,
    `        }`,
    `    });`,
    `</script>`,
  ].join('\n');
}

export function zonesCommand() {
  const cmd = new Command('zones')
    .description('List embed zones and generate tags for this account')
    .allowExcessArguments(false)
    .action(async (opts) => {
      const token = resolveToken(opts);
      const campaigns = await apiJson('/v2/campaigns/built', token, { verbose: opts.verbose, baseUrl: API_BASE });
      const zones = extractZoneNames(campaigns);
      if (zones.length === 0) {
        console.error('No zones found.');
        return;
      }
      if (opts.json) {
        printJson(zones, opts);
        return;
      }
      for (const z of zones) console.log(z);
    });

  addGlobalOptions(cmd, {
    output: true,
    examples: [
      'extole zones',
      'extole zones --account quim',
      'extole zones --json',
    ],
  });

  const coreCmd = new Command('core')
    .description('Print the core.js <script> tag for this account')
    .allowExcessArguments(false)
    .action(async function () {
      const opts = this.optsWithGlobals();
      const token = resolveToken(opts);
      const programs = await apiJson('/v2/programs', token, { verbose: opts.verbose, baseUrl: API_BASE });
      const domain = Array.isArray(programs) && programs[0]?.domain;
      const fallback = `origin.extole.com/${opts.account || getDefaultAccount() || 'unknown'}`;
      const coreUrl = domain || fallback;
      console.log(`<script type='text/javascript' src='https://${coreUrl}/core.js' fetchpriority='high' async></script>`);
    });

  addGlobalOptions(coreCmd, {
    examples: [
      'extole zones core',
      'extole zones core --account quim',
    ],
  });

  const tagCmd = new Command('tag')
    .description('Print the embed snippet for a zone')
    .argument('<zone_name>', 'Zone name (e.g. product_page)')
    .allowExcessArguments(false)
    .action(function (zoneName) {
      console.log(buildZoneTag(zoneName));
    });

  addGlobalOptions(tagCmd, {
    examples: [
      'extole zones tag product_page',
      'extole zones tag overlay --account quim',
    ],
  });

  cmd.addCommand(coreCmd);
  cmd.addCommand(tagCmd);
  return cmd;
}
