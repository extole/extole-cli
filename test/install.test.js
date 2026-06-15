import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

test('install.sh falls back to ~/.local/bin and updates the shell profile', {
  skip: usrLocalBinWritable() ? '/usr/local/bin is writable on this runner' : false,
}, () => {
  const home = mkdtempSync(join(tmpdir(), 'extole-home-'));
  const installDir = join(home, '.local', 'bin');
  const zshrc = join(home, '.zshrc');
  try {
    const env = { ...process.env, HOME: home, SHELL: '/bin/zsh', PATH: process.env.PATH };
    delete env.EXTOLE_INSTALL;

    const result = spawnSync('sh', [installSh], { cwd: repoRoot, env, encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(join(installDir, 'extole')), true);
    assert.match(result.stdout, /Added .* to your PATH|export PATH=/);

    const profileContents = readFileSync(zshrc, 'utf8');
    assert.match(profileContents, /\.local\/bin/);

    // Idempotent: a second run must not append a duplicate PATH line.
    const second = spawnSync('sh', [installSh], { cwd: repoRoot, env, encoding: 'utf8' });
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const after = readFileSync(zshrc, 'utf8');
    const occurrences = after.split('Added by extole-cli installer').length - 1;
    assert.equal(occurrences, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
