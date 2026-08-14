import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewardsCommand, VALID_REWARD_STATES } from '../src/commands/rewards.js';

function applyExitOverride(command) {
  command.exitOverride();
  command.configureOutput({ writeErr: () => {} });
  command.commands.forEach(applyExitOverride);
}

test('rewards expire requires a reward_id argument', async () => {
  const cmd = rewardsCommand();
  applyExitOverride(cmd);
  await assert.rejects(
    () => cmd.parseAsync(['expire'], { from: 'user' }),
    /missing required argument 'reward_id'/
  );
});

test('VALID_REWARD_STATES includes EXPIRED (platform now supports it as a filter/state)', () => {
  assert.ok(VALID_REWARD_STATES.has('EXPIRED'));
});
