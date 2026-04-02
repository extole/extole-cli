import { Command } from 'commander';
import { loadConfig, saveConfig, setProfile, getProfile } from '../config.js';
import { apiJson } from '../api.js';

export function authCommand() {
  const auth = new Command('auth');

  auth
    .command('login')
    .description('Save a bearer token')
    .requiredOption('--token <token>', 'Extole bearer token')
    .option('--profile <profile>', 'Profile name', 'default')
    .action((opts) => {
      setProfile(opts.profile, { token: opts.token });
      console.log(`Token saved to profile "${opts.profile}".`);
    });

  auth
    .command('logout')
    .description('Remove saved token')
    .option('--profile <profile>', 'Profile name', 'default')
    .action((opts) => {
      const config = loadConfig();
      if (config[opts.profile]) {
        delete config[opts.profile].token;
        saveConfig(config);
        console.log(`Token removed from profile "${opts.profile}".`);
      } else {
        console.log(`No profile "${opts.profile}" found.`);
      }
    });

  auth
    .command('status')
    .description('Show token and verify connectivity')
    .option('--profile <profile>', 'Profile name', 'default')
    .option('--token <token>', 'Override token for this call')
    .action(async (opts) => {
      const profile = getProfile(opts.profile);
      const token = opts.token || profile?.token;
      if (!token) {
        console.error('No token configured. Run `extole auth login --token <token>`.');
        process.exit(2);
      }
      const masked = token.slice(0, 8) + '...' + token.slice(-4);
      console.log(`Profile: ${opts.profile}`);
      console.log(`Token:   ${masked}`);
      try {
        const start = Date.now();
        await apiJson('/v4/report-types?limit=1', token);
        const ms = Date.now() - start;
        console.log(`Ping:    ${ms}ms — OK`);
      } catch (e) {
        console.error(`Ping failed: ${e.message}`);
        process.exit(1);
      }
    });

  return auth;
}
