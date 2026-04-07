import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

// Redirect config to a temp dir so tests never touch ~/.extole
const tmpDir = join(os.tmpdir(), `extole-cli-test-${process.pid}`);
process.env.HOME = tmpDir;

// Re-import after patching HOME so config.js picks up the temp dir
const { loadConfig, saveConfig, getProfile, setProfile, getDefaultAccount, setDefaultAccount, resolveToken } = await import('../src/config.js');

before(() => mkdirSync(tmpDir, { recursive: true }));
after(() => rmSync(tmpDir, { recursive: true, force: true }));

test('loadConfig returns empty object when no config file exists', () => {
  const config = loadConfig();
  assert.deepEqual(config, {});
});

test('saveConfig and loadConfig round-trip', () => {
  saveConfig({ _default: 'acme', acme: { token: 'tok123' } });
  const config = loadConfig();
  assert.equal(config._default, 'acme');
  assert.equal(config.acme.token, 'tok123');
});

test('getDefaultAccount returns the default account name', () => {
  saveConfig({ _default: 'acme', acme: { token: 'tok123' } });
  assert.equal(getDefaultAccount(), 'acme');
});

test('setDefaultAccount updates the default', () => {
  saveConfig({ _default: 'acme', acme: { token: 'a' }, beta: { token: 'b' } });
  setDefaultAccount('beta');
  assert.equal(getDefaultAccount(), 'beta');
});

test('getProfile returns profile data for named account', () => {
  saveConfig({ _default: 'acme', acme: { token: 'tok-acme' } });
  const profile = getProfile('acme');
  assert.equal(profile.token, 'tok-acme');
});

test('getProfile uses default account when no name given', () => {
  saveConfig({ _default: 'acme', acme: { token: 'tok-acme' } });
  const profile = getProfile(null);
  assert.equal(profile.token, 'tok-acme');
});

test('getProfile returns null for unknown account', () => {
  saveConfig({ _default: 'acme', acme: { token: 'tok-acme' } });
  assert.equal(getProfile('nonexistent'), null);
});

test('setProfile merges data into existing profile', () => {
  saveConfig({ acme: { token: 'old', extra: 'keep' } });
  setProfile('acme', { token: 'new' });
  const profile = getProfile('acme');
  assert.equal(profile.token, 'new');
  assert.equal(profile.extra, 'keep');
});

test('resolveToken returns token from options if provided', () => {
  const token = resolveToken({ token: 'direct-token' });
  assert.equal(token, 'direct-token');
});

test('resolveToken resolves token from saved account', () => {
  saveConfig({ _default: 'acme', acme: { token: 'saved-token' } });
  const token = resolveToken({});
  assert.equal(token, 'saved-token');
});

test('resolveToken resolves token from named account via --account', () => {
  saveConfig({ acme: { token: 'acme-token' }, beta: { token: 'beta-token' } });
  const token = resolveToken({ account: 'beta' });
  assert.equal(token, 'beta-token');
});
