import { test } from 'node:test';
import assert from 'node:assert/strict';
import { componentsCommand } from '../src/commands/components.js';
import { rewardsCommand } from '../src/commands/rewards.js';
import { apiCommand } from '../src/commands/api.js';
import { healthCommand } from '../src/commands/health.js';
import { rewardSuppliersCommand } from '../src/commands/reward-suppliers.js';
import { webhooksCommand } from '../src/commands/webhooks.js';

function findSubcommand(root, ...names) {
  let command = root;
  for (const name of names) {
    command = command.commands.find(c => c.name() === name);
  }
  return command;
}

// A subcommand's explicitly-passed --account/--token must win over the parent command's
// own copy of that option — commander's optsWithGlobals() lets ancestor values overwrite
// descendant values during merge, so if the parent's copy carries a default, it silently
// clobbers whatever the subcommand actually parsed (see src/utils.js addGlobalOptions).
async function capturesExplicitAccount(root, subcommandPath, args) {
  const target = findSubcommand(root, ...subcommandPath);
  let captured;
  target.action(function () {
    captured = this.optsWithGlobals().account;
  });
  await root.parseAsync(args, { from: 'user' });
  return captured;
}

// A parent command that both defines its own options and hosts subcommands must not let
// those options leak into a subcommand's own parsing — commander only prevents that when
// the parent calls enablePositionalOptions().

function applyExitOverride(command) {
  command.exitOverride();
  command.configureOutput({ writeErr: () => {} });
  command.commands.forEach(applyExitOverride);
}

async function rejectsWithUnknownOption(command, args, optionName) {
  applyExitOverride(command);
  await assert.rejects(
    () => command.parseAsync(args, { from: 'user' }),
    new RegExp(`unknown option '${optionName}'`)
  );
}

test('rewards get rejects --status (defined only on the parent rewards command)', async () => {
  await rejectsWithUnknownOption(rewardsCommand(), ['get', 'r-1', '--status', 'EARNED'], '--status');
});

test('rewards suppliers get rejects --include-archived (defined only on the parent suppliers command)', async () => {
  await rejectsWithUnknownOption(rewardsCommand(), ['suppliers', 'get', 's-1', '--include-archived'], '--include-archived');
});

test('api search rejects --method (defined only on the parent api command)', async () => {
  await rejectsWithUnknownOption(apiCommand(), ['search', 'foo', '--method', 'POST'], '--method');
});

test('health provision-dkim rejects --domain (defined only on the parent health command)', async () => {
  await rejectsWithUnknownOption(healthCommand(), ['provision-dkim', '--domain', 'example.com'], '--domain');
});

test('reward-suppliers get rejects --filter (defined only on the parent reward-suppliers command)', async () => {
  await rejectsWithUnknownOption(rewardSuppliersCommand(), ['get', 'sup-1', '--filter', 'bhn'], '--filter');
});

test('webhooks get rejects --enabled (defined only on the parent webhooks command)', async () => {
  await rejectsWithUnknownOption(webhooksCommand(), ['get', 'wh-1', '--enabled', 'true'], '--enabled');
});

// ── --account resolution on subcommands ─────────────────────────────────────

test('components get uses the explicitly-passed --account, not the parent default', async () => {
  const account = await capturesExplicitAccount(componentsCommand(), ['get'], ['get', 'cmp-1', '--account', 'quim']);
  assert.equal(account, 'quim');
});

test('rewards get uses the explicitly-passed --account, not the parent default', async () => {
  const account = await capturesExplicitAccount(rewardsCommand(), ['get'], ['get', 'r-1', '--account', 'quim']);
  assert.equal(account, 'quim');
});

test('rewards suppliers get uses the explicitly-passed --account, not an ancestor default', async () => {
  const account = await capturesExplicitAccount(rewardsCommand(), ['suppliers', 'get'], ['suppliers', 'get', 's-1', '--account', 'quim']);
  assert.equal(account, 'quim');
});

test('api search uses the explicitly-passed --account, not the parent default', async () => {
  const account = await capturesExplicitAccount(apiCommand(), ['search'], ['search', 'foo', '--account', 'quim']);
  assert.equal(account, 'quim');
});

test('health provision-dkim uses the explicitly-passed --account, not the parent default', async () => {
  const account = await capturesExplicitAccount(healthCommand(), ['provision-dkim'], ['provision-dkim', 'example.com', '--account', 'quim']);
  assert.equal(account, 'quim');
});

test('reward-suppliers get uses the explicitly-passed --account, not the parent default', async () => {
  const account = await capturesExplicitAccount(rewardSuppliersCommand(), ['get'], ['get', 'sup-1', '--account', 'quim']);
  assert.equal(account, 'quim');
});

test('webhooks get uses the explicitly-passed --account, not the parent default', async () => {
  const account = await capturesExplicitAccount(webhooksCommand(), ['get'], ['get', 'wh-1', '--account', 'quim']);
  assert.equal(account, 'quim');
});
