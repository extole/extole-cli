import { Command, Option } from 'commander';
import { loadConfig, saveConfig, setProfile, getProfile, getDefaultAccount, setDefaultAccount, AUTH_BASE } from '../config.js';
import { apiFetch, apiJson } from '../api.js';

export async function mintClientToken(suToken, clientId, verbose, fetchFn) {
  let res, text;
  try {
    res = await apiFetch('/v4/tokens', suToken, {
      method: 'POST',
      body: JSON.stringify({ client_id: clientId }),
      baseUrl: AUTH_BASE,
      verbose,
    }, fetchFn);
    text = await res.text();
  } catch (e) {
    throw new Error(`Failed to mint client token for ${clientId}: ${e.message}`);
  }
  if (!res.ok) {
    throw new Error(`Failed to mint client token for ${clientId}: ${res.status}: ${text.slice(0, 300)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Unexpected response: ${text.slice(0, 200)}`);
  }
  const clientToken = data.access_token;
  if (!clientToken) {
    throw new Error(`No access_token in response: ${text.slice(0, 200)}`);
  }
  return clientToken;
}

export function authCommand() {
  const auth = new Command('auth')
    .description('Manage Extole credentials');

  auth
    .command('login')
    .description('Save a token for an account')
    .allowExcessArguments(false)
    .requiredOption('--account <name>', 'Account name to save token under')
    .requiredOption('--token <token>', 'Extole bearer token')
    .option('--set-default', 'Set this account as the default')
    .addHelpText('after', `
Examples:
  extole auth login --token TOKEN --account acme --set-default
  extole auth login --token TOKEN --account staging`)
    .action(function() {
      const { token, account } = this.opts();
      const isDefault = this.opts().setDefault;
      const trimmedToken = token.trim();
      if (!trimmedToken || trimmedToken.length < 10) {
        console.error('Error: token appears invalid (too short).');
        process.exit(2);
      }
      setProfile(account, { token: trimmedToken });
      if (isDefault) {
        setDefaultAccount(account);
        console.log(`Token saved to account "${account}" (default).`);
      } else {
        console.log(`Token saved to account "${account}".`);
      }
    });

  auth
    .command('logout')
    .description('Remove saved token for an account')
    .allowExcessArguments(false)
    .addOption(
      new Option('--account <name>', 'Account to log out')
        .default(getDefaultAccount())
        .env('EXTOLE_ACCOUNT')
    )
    .addHelpText('after', `
Examples:
  extole auth logout --account acme
  extole auth logout`)
    .action(function() {
      const { account } = this.opts();
      if (!account) {
        console.error('Error: --account NAME is required (no default account set).');
        process.exit(2);
      }
      const config = loadConfig();
      if (config[account]) {
        delete config[account];
        if (config._default === account) delete config._default;
        saveConfig(config);
        console.log(`Account "${account}" removed.`);
      } else {
        console.log(`No account "${account}" found.`);
      }
    });

  auth
    .command('default')
    .description('Set the default account')
    .allowExcessArguments(false)
    .argument('<account>', 'Account name to set as default')
    .addHelpText('after', `
Examples:
  extole auth default acme`)
    .action((account) => {
      const config = loadConfig();
      if (!config[account]) {
        console.error(`No account "${account}" found. Run \`extole auth list\` to see saved accounts.`);
        process.exit(2);
      }
      setDefaultAccount(account);
      console.log(`Default account set to "${account}".`);
    });

  auth
    .command('list')
    .description('List all saved accounts')
    .allowExcessArguments(false)
    .addHelpText('after', `
Examples:
  extole auth list`)
    .action(() => {
      const config = loadConfig();
      const defaultAccount = getDefaultAccount();
      const accounts = Object.keys(config).filter(k => k !== '_default');
      if (accounts.length === 0) {
        console.log('No accounts saved. Run `extole auth login --token TOKEN --account NAME` to add one.');
        return;
      }
      for (const name of accounts) {
        const token = config[name]?.token;
        const masked = token
          ? (token.length > 12 ? token.slice(0, 8) + '...' + token.slice(-4) : '***')
          : '(no token)';
        const marker = name === defaultAccount ? '  (default)' : '';
        console.log(`${name.padEnd(20)}  ${masked}${marker}`);
      }
    });

  auth
    .command('su')
    .description('Mint a client-scoped token from a superuser token and save it')
    .allowExcessArguments(false)
    .requiredOption('--token <token>', 'Superuser bearer token')
    .requiredOption('--client <client_id>', 'Client ID to scope the token to (numeric ID, not shortname)')
    .option('--account <name>', 'Account name to save the minted token under (default: client ID)')
    .option('--set-default', 'Set this account as the default')
    .option('--verbose', 'Log each HTTP request to stderr')
    .addHelpText('after', `
Examples:
  extole auth su --token SU_TOKEN --client CLIENT_ID
  extole auth su --token SU_TOKEN --client CLIENT_ID --set-default
  extole auth su --token SU_TOKEN --client CLIENT_ID --account acme --set-default`)
    .action(async function() {
      const { token, client, setDefault: isDefault } = this.opts();
      const account = this.opts().account || client;

      let clientToken;
      try {
        clientToken = await mintClientToken(token, client, this.opts().verbose);
      } catch (e) {
        console.error(e.message);
        process.exit(1);
      }

      setProfile(account, { token: clientToken });
      if (isDefault) {
        setDefaultAccount(account);
        console.log(`Client token minted and saved to account "${account}" (default).`);
      } else {
        console.log(`Client token minted and saved to account "${account}".`);
      }
    });

  auth
    .command('token')
    .description('Print the raw token for an account (for piping into other tools)')
    .allowExcessArguments(false)
    .addOption(
      new Option('--account <name>', 'Account to read token from')
        .default(getDefaultAccount())
        .env('EXTOLE_ACCOUNT')
    )
    .addHelpText('after', `
Examples:
  extole auth token
  extole auth token --account acme
  extole auth token | pbcopy
  some-tool --token $(extole auth token)`)
    .action(function() {
      const { account } = this.opts();
      if (!account) {
        console.error('Error: --account NAME is required (no default account set).');
        process.exit(2);
      }
      const profile = getProfile(account);
      const token = profile?.token;
      if (!token) {
        console.error(`No token for account "${account}". Run \`extole auth login --token TOKEN --account NAME\`.`);
        process.exit(2);
      }
      process.stderr.write('# treat this token as a credential — do not log or share\n');
      process.stdout.write(token + '\n');
    });

  auth
    .command('status')
    .description('Show token and verify connectivity')
    .allowExcessArguments(false)
    .addOption(
      new Option('--account <name>', 'Account to check')
        .default(getDefaultAccount())
        .env('EXTOLE_ACCOUNT')
    )
    .addHelpText('after', `
Examples:
  extole auth status
  extole auth status --account acme`)
    .action(async function() {
      const { account } = this.opts();
      if (!account) {
        console.error('Error: --account NAME is required (no default account set).');
        process.exit(2);
      }
      const profile = getProfile(account);
      const token = profile?.token;
      if (!token) {
        console.error(`No token for account "${account}". Run \`extole auth login --token TOKEN --account NAME\`.`);
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
