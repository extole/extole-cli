import { createServer } from 'http';
import { randomBytes, createHash } from 'crypto';
import { exec } from 'child_process';
import { Command, Option } from 'commander';
import { loadConfig, saveConfig, setProfile, getProfile, getDefaultAccount, setDefaultAccount, AUTH_BASE, API_BASE } from '../config.js';
import { apiFetch, apiJson } from '../api.js';
import { fetchWithTimeout } from '../utils.js';

const IDP_BASE = 'https://idp.extole.com';
const MCP_CLIENT_ID = 'extole-cli';

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
      const isFirst = Object.keys(config).filter(k => k !== '_default' && k !== '_mcp').length === 0;
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
    .command('su')
    .description('Use a superuser token (--token) to mint a client-scoped token and save it as a named account (--account)')
    .allowExcessArguments(false)
    .requiredOption('--token <token>', 'Superuser bearer token')
    .requiredOption('--client <client_id>', 'Client ID to scope the token to (numeric ID, not shortname)')
    .option('--account <name>', 'Account name to save the minted token under (default: client ID)')
    .option('--set-default', 'Set this account as the default')
    .addHelpText('after', `
Global Options:
  --verbose            Log each HTTP request to stderr

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

      setProfile(account, { token: clientToken, su_client: client });
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

  auth
    .command('mcp-login')
    .description('Authenticate with Extole AI via browser login (separate from API token auth)')
    .allowExcessArguments(false)
    .addHelpText('after', `
Examples:
  extole auth mcp-login`)
    .action(async function () {
      // Generate PKCE pair and state
      const codeVerifier = randomBytes(32).toString('base64url');
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
      const state = randomBytes(16).toString('base64url');

      // Start a one-shot local server on 127.0.0.1 to catch the OAuth callback
      let resolveCode, rejectCode;
      const codePromise = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });

      const server = createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/oauth/callback') {
          res.writeHead(404); res.end(); return;
        }
        const error = url.searchParams.get('error');
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end(`Login failed: ${error}`);
          rejectCode(new Error(error));
          return;
        }
        if (url.searchParams.get('state') !== state) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Login failed: state mismatch');
          rejectCode(new Error('state mismatch'));
          return;
        }
        const code = url.searchParams.get('code');
        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><p>Login successful — you may close this tab.</p></body></html>');
          resolveCode(code);
        }
      });

      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;

      const authUrl = new URL(`${IDP_BASE}/oauth2/authorize`);
      authUrl.searchParams.set('client_id', MCP_CLIENT_ID);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', 'openid profile email');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('state', state);

      console.log('Opening browser for Extole MCP login...');
      console.log(`If the browser does not open, visit:\n${authUrl.toString()}\n`);

      const openCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      exec(`${openCmd} "${authUrl.toString()}"`);

      const timeout = setTimeout(() => {
        server.close();
        rejectCode(new Error('Login timed out after 2 minutes'));
      }, 120_000);

      let code;
      try {
        code = await codePromise;
      } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      } finally {
        clearTimeout(timeout);
        server.close();
      }

      // Exchange code for tokens
      const tokenRes = await fetchWithTimeout(`${IDP_BASE}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: MCP_CLIENT_ID,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        console.error(`Error: token exchange failed (${tokenRes.status}): ${text}`);
        process.exit(1);
      }

      const tokenData = await tokenRes.json();
      const jwt = tokenData.access_token;
      if (!jwt) {
        console.error('Error: no access_token in IDP response');
        process.exit(1);
      }

      const config = loadConfig();
      config._mcp = { token: jwt };
      if (tokenData.expires_in) {
        config._mcp.expiresAt = Date.now() + tokenData.expires_in * 1000;
      }
      if (tokenData.refresh_token) {
        config._mcp.refreshToken = tokenData.refresh_token;
      }
      saveConfig(config);

      console.log('MCP login successful. Token saved.');
    });

  return auth;
}
