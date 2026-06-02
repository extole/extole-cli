import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VALID_REWARD_STATES } from '../src/commands/rewards.js';

test('VALID_REWARD_STATES includes expected states', () => {
  for (const state of ['EARNED', 'FULFILLED', 'SENT', 'REDEEMED', 'CANCELED', 'FAILED', 'REVOKED', 'EXPIRED']) {
    assert.ok(VALID_REWARD_STATES.has(state), `expected ${state} to be valid`);
  }
});

test('VALID_REWARD_STATES rejects unknown status', () => {
  assert.equal(VALID_REWARD_STATES.has('BOGUS'), false);
  assert.equal(VALID_REWARD_STATES.has(''), false);
  assert.equal(VALID_REWARD_STATES.has('earned'), false); // case-sensitive
});
