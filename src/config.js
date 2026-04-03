import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.extole');
const CONFIG_FILE = join(CONFIG_DIR, 'config');

export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function saveConfig(config) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function getProfile(profileName = 'default') {
  const config = loadConfig();
  return config[profileName] || null;
}

export function setProfile(profileName = 'default', data) {
  const config = loadConfig();
  config[profileName] = { ...config[profileName], ...data };
  saveConfig(config);
}

export function resolveToken(options) {
  if (options.token) return options.token;
  const profile = getProfile(options.account);
  if (profile?.token) return profile.token;
  console.error('Error: no token found. Run `extole auth --token <token>` or set EXTOLE_TOKEN.');
  process.exit(2);
}

export const BASE_URL = 'https://my.extole.com';
export const PERSON_BASE = 'https://api.extole.io';
