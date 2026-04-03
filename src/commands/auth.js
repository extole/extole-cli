import { Command, Option } from 'commander';
import { loadConfig, saveConfig, setProfile, getProfile } from '../config.js';
import { apiJson } from '../api.js';

export function authCommand() {
  const auth = new Command('auth')
    .description('Save, remove, or verify Extole credentials')
    .option('--token <token>', 'Extole bearer token')
    .addOption(
      new Option('--account <name>', 'Saved account name')
        .default('default')
        .env('EXTOLE_ACCOUNT')
    )
    .addHelpText('after', `
Examples:
  extole auth --token <token>
  extole auth --token <token> --account my-client`)
    .action((opts) => {
      if (!opts.token) {
        console.error('Error: --token <token> is required.');
        process.exit(2);
      }
      setProfile(opts.account, { token: opts.token });
      console.log(`Token saved to account "${opts.account}".`);
    });

  auth
    .command('list')
    .description('List all saved accounts')
    .addHelpText('after', `
Examples:
  extole auth list`)
    .action(() => {
      const config = loadConfig();
      const accounts = Object.keys(config);
      if (accounts.length === 0) {
        console.log('No accounts saved. Run `extole auth --token <token>` to add one.');
        return;
      }
      for (const name of accounts) {
        const token = config[name]?.token;
        const masked = token
          ? (token.length > 12 ? token.slice(0, 8) + '...' + token.slice(-4) : '***')
          : '(no token)';
        console.log(`${name.padEnd(20)}  ${masked}`);
      }
    });

  auth
    .command('logout')
    .description('Remove saved token for an account')
    .addHelpText('after', `
Examples:
  extole auth logout
  extole auth logout --account my-client`)
    .action(function() {
      const { account } = this.optsWithGlobals();
      const config = loadConfig();
      if (config[account]) {
        delete config[account].token;
        saveConfig(config);
        console.log(`Token removed from account "${account}".`);
      } else {
        console.log(`No account "${account}" found.`);
      }
    });

  auth
    .command('status')
    .description('Show token and verify connectivity')
    .addHelpText('after', `
Examples:
  extole auth status
  extole auth status --account my-client`)
    .action(async function() {
      const { account } = this.optsWithGlobals();
      const profile = getProfile(account);
      const token = profile?.token;
      if (!token) {
        console.error('No token configured. Run `extole auth --token <token>`.');
        process.exit(2);
      }
      const masked = token.length > 12 ? token.slice(0, 8) + '...' + token.slice(-4) : '***';
      console.log(`Account: ${account}`);
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
