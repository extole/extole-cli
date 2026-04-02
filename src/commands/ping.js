import { Command } from 'commander';
import { resolveToken } from '../config.js';
import { apiFetch } from '../api.js';

export function pingCommand() {
  return new Command('ping')
    .description('Verify credentials and connectivity')
    .option('--token <token>', 'Override token for this call')
    .option('--profile <profile>', 'Profile name', 'default')
    .action(async (opts) => {
      const token = resolveToken(opts);
      try {
        const start = Date.now();
        const res = await apiFetch('/v4/me', token);
        const ms = Date.now() - start;
        if (res.ok) {
          const data = await res.json();
          console.log(`OK  ${ms}ms  client=${data.client_id || data.id || '(unknown)'}`);
          process.exit(0);
        } else {
          console.error(`FAIL  ${res.status}  ${ms}ms`);
          process.exit(1);
        }
      } catch (e) {
        console.error(`FAIL  ${e.message}`);
        process.exit(1);
      }
    });
}
