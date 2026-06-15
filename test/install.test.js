import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, constants, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const installSh = join(repoRoot, 'install.sh');

function usrLocalBinWritable() {
  if (!existsSync('/usr/local/bin')) return false;
  try {
    accessSync('/usr/local/bin', constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

test('install.sh installs binary to EXTOLE_INSTALL directory', () => {
  const installDir = mkdtempSync(join(tmpdir(), 'extole-install-'));
  try {
    const result = spawnSync('sh', [installSh], {
      cwd: repoRoot,
      env: { ...process.env, EXTOLE_INSTALL: installDir, PATH: process.env.PATH },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(join(installDir, 'extole')), true);

    const version = spawnSync(join(installDir, 'extole'), ['--version'], { encoding: 'utf8' });
    assert.equal(version.status, 0);
    assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
  } finally {
    rmSync(installDir, { recursive: true, force: true });
  }
});

test('install.sh falls back when /usr/local/bin is not writable', (t) => {
  if (usrLocalBinWritable()) {
    t.skip('/usr/local/bin is writable on this runner');
  }

  const home = mkdtempSync(join(tmpdir(), 'extole-home-'));
  const installDir = join(home, '.local', 'bin');
  try {
    const result = spawnSync('sh', [installSh], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: home,
        PATH: process.env.PATH,
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(join(installDir, 'extole')), true);
    assert.match(result.stdout, /not writable|Add to your shell profile/i);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
