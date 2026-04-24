import { Command } from 'commander';
import { resolveToken, loadConfig, getDefaultAccount, BASE_URL, PERSON_BASE } from '../config.js';
import { apiFetch } from '../api.js';
import { printJson } from '../output.js';
import { addGlobalOptions } from '../utils.js';

export function whoamiCommand() {
  return addGlobalOptions(
    new Command('whoami')
      .description('Show current account, token, and base URLs. Optionally verify connectivity with --ping.')
      .allowExcessArguments(false)
      .option('--ping', 'Also verify connectivity and report latency')
      .action(async (opts) => {
        const config = loadConfig();
        const accountName = opts.account || getDefaultAccount();
        if (!accountName) {
          console.error('No default account set. Run: extole auth login --token TOKEN --account NAME --default');
          process.exit(2);
        }

        const profile = config[accountName] || {};
        const token = opts.token || profile.token;
        const masked = token && token.length > 12 ? token.slice(0, 8) + '...' + token.slice(-4) : '***';
        const suClient = profile.su_client || null;

        let pingMs = null;
        let pingOk = null;
        if (opts.ping && token) {
          try {
            const start = Date.now();
            const res = await apiFetch('/v4/report-types?limit=1', token, { verbose: opts.verbose });
            pingMs = Date.now() - start;
            pingOk = res.ok;
          } catch (e) {
            pingOk = false;
          }
        }

        if (opts.json) {
          const out = { account: accountName, token: masked, api: PERSON_BASE, my: BASE_URL };
          if (suClient) out.su_client = suClient;
          if (pingMs !== null) out.ping = pingOk ? `${pingMs}ms` : 'FAIL';
          printJson(out, opts);
          return;
        }

        console.log(`account:  ${accountName}`);
        if (suClient) console.log(`client:   ${suClient}`);
        console.log(`token:    ${masked}`);
        console.log(`api:      ${PERSON_BASE}`);
        console.log(`my:       ${BASE_URL}`);
        if (pingMs !== null) console.log(`ping:     ${pingOk ? `${pingMs}ms — OK` : 'FAIL'}`);
      }),
    {
      examples: [
        'extole whoami',
        'extole whoami --ping',
        'extole whoami --account other-client',
        'extole whoami --json',
      ],
    }
  );
}
