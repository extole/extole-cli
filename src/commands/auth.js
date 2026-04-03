import { Command } from 'commander';
import { Option } from 'commander';
import { loadConfig, saveConfig, setProfile, getProfile } from '../config.js';
import { apiJson } from '../api.js';

function accountOption() {
  return new Option('--account <name>', 'Saved account name')
    .default('default')
    .env('EXTOLE_ACCOUNT');
}

export function authCommand() {
  const auth = new Command('auth').description('Manage authentication tokens');

  auth
    .command('login')
    .description('Save a bearer token for an account')
    .requiredOption('--token <token>', 'Extole bearer token')
    .addOption(accountOption())
    .addHelpText('after', `
Examples:
  extole auth login --token <token>
  extole auth login --token <token> --account my-client`)
    .action((opts) => {
      setProfile(opts.account, { token: opts.token });
      console.log(`Token saved to account "${opts.account}".`);
    });

  auth
    .command('logout')
    .description('Remove saved token for an account')
    .addOption(accountOption())
    .action((opts) => {
      const config = loadConfig();
      if (config[opts.account]) {
        delete config[opts.account].token;
        saveConfig(config);
        console.log(`Token removed from account "${opts.account}".`);
      } else {
        console.log(`No account "${opts.account}" found.`);
      }
    });

  auth
    .command('status')
    .description('Show token and verify connectivity')
    .addOption(accountOption())
    .addOption(
      new Option('--token <token>', 'Override token for this call').env('EXTOLE_TOKEN')
    )
    .addHelpText('after', `
Examples:
  extole auth status
  extole auth status --account my-client`)
    .action(async (opts) => {
      const profile = getProfile(opts.account);
      const token = opts.token || profile?.token;
      if (!token) {
        console.error('No token configured. Run `extole auth login --token <token>`.');
        process.exit(2);
      }
      const masked = token.length > 12 ? token.slice(0, 8) + '...' + token.slice(-4) : '***';
      console.log(`Account: ${opts.account}`);
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
