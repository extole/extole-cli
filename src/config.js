import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.extole');
const CONFIG_FILE = join(CONFIG_DIR, 'config');

export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return {};
  const raw = readFileSync(CONFIG_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    process.stderr.write(`Error: config file at ${CONFIG_FILE} is not valid JSON. Please fix or delete it.\n`);
    process.exit(1);
  }
}

export function saveConfig(config) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function getDefaultAccount() {
  const config = loadConfig();
  return config._default || null;
}

export function setDefaultAccount(name) {
  const config = loadConfig();
  config._default = name;
  saveConfig(config);
}

export function getProfile(profileName) {
  const config = loadConfig();
  const name = profileName || config._default;
  if (!name) return null;
  return config[name] || null;
}

export function setProfile(profileName, data) {
  const config = loadConfig();
  config[profileName] = { ...config[profileName], ...data };
  saveConfig(config);
}

export function resolveToken(options) {
  if (options.token) return options.token;
  const config = loadConfig();
  const accountName = options.account || config._default;
  if (!accountName) {
    console.error(`Error: no default account set. Run 'extole auth login --token TOKEN --account NAME --default' to get started.`);
    process.exit(2);
  }
  const profile = config[accountName];
  if (profile?.token) return profile.token;
  console.error(`Error: no token for account "${accountName}". Run 'extole auth list' to see saved accounts. Then use --account NAME or set EXTOLE_ACCOUNT.`);
  process.exit(2);
}

export function getSuClientForToken(token) {
  const config = loadConfig();
  for (const [key, val] of Object.entries(config)) {
    if (key.startsWith('_')) continue;
    if (val?.token === token && val?.su_client) return val.su_client;
  }
  return null;
}

export const API_BASE = 'https://api.extole.io';
export const AUTH_BASE = 'https://api.extole.com';

export const IDP_BASE = 'https://idp.extole.com';
export const MCP_CLIENT_ID = 'extole-cli';

// Returns a valid MCP IDP token, refreshing if needed.
// Returns null if no token is stored (caller should trigger login).
export async function getMcpToken() {
  const config = loadConfig();
  const mcp = config._mcp;
  if (!mcp?.token) return null;

  const REFRESH_BUFFER_MS = 60_000;
  if (!mcp.expiresAt || Date.now() < mcp.expiresAt - REFRESH_BUFFER_MS) {
    return mcp.token;
  }

  if (!mcp.refreshToken) return null;

  const res = await fetch(`${IDP_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: MCP_CLIENT_ID,
      refresh_token: mcp.refreshToken,
    }),
  });
  if (!res.ok) return null;

  const data = await res.json();
  if (!data.access_token) return null;

  config._mcp = { token: data.access_token };
  if (data.expires_in) config._mcp.expiresAt = Date.now() + data.expires_in * 1000;
  if (data.refresh_token) config._mcp.refreshToken = data.refresh_token;
  saveConfig(config);
  return config._mcp.token;
}

export function saveMcpToken(tokenData) {
  const config = loadConfig();
  config._mcp = { token: tokenData.access_token };
  if (tokenData.expires_in) config._mcp.expiresAt = Date.now() + tokenData.expires_in * 1000;
  if (tokenData.refresh_token) config._mcp.refreshToken = tokenData.refresh_token;
  saveConfig(config);
}
