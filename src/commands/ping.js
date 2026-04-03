import { Command } from 'commander';
import { resolveToken } from '../config.js';
import { apiFetch } from '../api.js';
import { addGlobalOptions } from '../utils.js';

export function pingCommand() {
  return addGlobalOptions(
    new Command('ping')
      .description('Verify credentials and connectivity')
      .action(async (opts) => {
        const token = resolveToken(opts);
        try {
          const start = Date.now();
          const res = await apiFetch('/v4/report-types?limit=1', token);
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
    { examples: ['extole ping', 'extole ping --account my-client'] }
  );
}
