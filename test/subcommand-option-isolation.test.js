import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewardsCommand } from '../src/commands/rewards.js';
import { apiCommand } from '../src/commands/api.js';
import { healthCommand } from '../src/commands/health.js';
import { rewardSuppliersCommand } from '../src/commands/reward-suppliers.js';
import { webhooksCommand } from '../src/commands/webhooks.js';

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
