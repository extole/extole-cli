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

export const API_BASE = 'https://api.extole.io';
export const AUTH_BASE = 'https://api.extole.com';
