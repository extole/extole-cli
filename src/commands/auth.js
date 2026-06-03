import { Command, Option } from 'commander';
import { loadConfig, saveConfig, setProfile, getProfile, getDefaultAccount, setDefaultAccount, AUTH_BASE, API_BASE } from '../config.js';
import { apiJson } from '../api.js';

export function authCommand() {
  const auth = new Command('auth')
    .description('Manage Extole credentials');

  auth
    .command('login')
    .description('Save a token for an account')
    .allowExcessArguments(false)
    .option('--account <name>', 'Account name to save token under (defaults to "default")')
    .requiredOption('--token <token>', 'Extole bearer token')
    .option('--set-default', 'Set this account as the default')
    .addHelpText('after', `
Examples:
  extole auth login --token TOKEN
  extole auth login --token TOKEN --account acme --set-default
  extole auth login --token TOKEN --account staging`)
    .action(async function() {
      const opts = this.opts();
      const trimmedToken = opts.token.trim();
      if (!trimmedToken || trimmedToken.length < 10) {
        console.error('Error: token appears invalid (too short).');
        process.exit(2);
      }

      let account = opts.account;
      if (!account) {
        try {
          const tokenInfo = await apiJson('/v4/tokens', trimmedToken, { baseUrl: AUTH_BASE });
          const clientId = tokenInfo?.client_id;
          if (clientId) {
            const clientInfo = await apiJson(`/v4/clients/${clientId}`, trimmedToken, { baseUrl: API_BASE });
            account = clientInfo?.short_name;
          }
        } catch (_) { /* fall through to default */ }
        account = account || 'default';
      }

      const config = loadConfig();
      const isFirst = Object.keys(config).filter(k => !k.startsWith('_')).length === 0;
      const isDefault = opts.setDefault || !opts.account || isFirst;
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
      const accounts = Object.keys(config).filter(k => !k.startsWith('_'));
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
        await apiJson('/v6/report-types?limit=1', token);
        const ms = Date.now() - start;
        console.log(`Ping:    ${ms}ms — OK`);
      } catch (e) {
        console.error(`Ping failed: ${e.message}`);
        process.exit(1);
      }
    });

  const loginCmd = auth.commands.find(c => c.name() === 'login');
  const logoutCmd = auth.commands.find(c => c.name() === 'logout');
  const listCmd = auth.commands.find(c => c.name() === 'list');
  const statusCmd = auth.commands.find(c => c.name() === 'status');
  const defaultCmd = auth.commands.find(c => c.name() === 'default');
  const tokenCmd = auth.commands.find(c => c.name() === 'token');

  if (loginCmd) loginCmd._mcpDescription = 'Save an Extole API token for an account. Call this when the user provides a new token or when a tool returns a 401/403 error indicating the current token is invalid or expired. Use --account to name it and --set-default to make it the active account.';
  if (logoutCmd) logoutCmd._mcpDescription = 'Remove a saved account token from local storage. After logout, tool calls targeting that account will fail with a 401 until a new token is saved via auth_login. Does not invalidate the token on the Extole server — only removes the local copy. Use auth_list first to confirm which accounts are configured.';
  if (listCmd) listCmd._mcpDescription = 'List all saved Extole accounts with masked tokens and the default marker. Call this when the user asks which accounts are configured, or when you need to know what account names are available before switching. Use whoami to verify the active token is working.';
  if (statusCmd) statusCmd._mcpDescription = 'Verify a saved token is valid and measure API latency. Call this when troubleshooting authentication issues or confirming a newly saved token works before using it. Returns account name, masked token, and ping latency.';
  if (defaultCmd) defaultCmd._mcpDescription = 'Set the default account used when no --account flag is passed — affects all subsequent tool calls. Call this only when the user explicitly says "switch to account X" or "make X my default". For one-off calls against a different account, use --account per-command instead to avoid silently changing the active account. Use auth_list to confirm the current default before switching.';
  if (tokenCmd) tokenCmd._mcpDescription = 'Print the raw bearer token for a saved account. SECURITY SENSITIVE — call this only when the user explicitly requests the raw token value, or when constructing a command (e.g. curl) that requires a Bearer token directly. Do not call proactively or as a convenience. Do not call to validate a token — use whoami for that.';

  return auth;
}
