import { Command } from 'commander';
import { resolveToken } from '../config.js';
import { apiFetch } from '../api.js';
import { addGlobalOptions } from '../utils.js';

export function pingCommand() {
  const cmd = new Command('ping')
    .description('Verify credentials and connectivity');
  cmd._mcpDescription = 'Lightweight connectivity check — makes a single GET request and returns exit code 0 (OK) or 1 (fail) with latency. Use this to confirm the token and network are working before a batch of calls. Returns only "OK Nms" — use whoami instead if you need identity details, scopes, or client_id.';
  return addGlobalOptions(
    cmd
      .allowExcessArguments(false)
      .action(async (opts) => {
        const token = resolveToken(opts);
        try {
          const start = Date.now();
          const res = await apiFetch('/v6/report-types?limit=1', token, { verbose: opts.verbose });
          const ms = Date.now() - start;
          if (res.ok) {
            console.log(`OK  ${ms}ms`);
            process.exit(0);
          } else {
            console.error(`FAIL  ${res.status}  ${ms}ms`);
            process.exit(1);
          }
        } catch (e) {
          console.error(`FAIL  ${e.message}`);
          process.exit(1);
        }
      }),
    {
      examples: ['extole ping', 'extole ping --account my-client'],
      exitCodes: '0 = OK, 1 = unreachable or auth failure',
    }
  );
}
