import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VALID_FACE_VALUE_TYPES, VALID_CUSTOM_REWARD_TYPES } from '../src/commands/reward-suppliers.js';

test('VALID_FACE_VALUE_TYPES includes common currencies', () => {
  for (const type of ['USD', 'GBP', 'EUR', 'CAD', 'POINTS', 'PERCENT_OFF']) {
    assert.ok(VALID_FACE_VALUE_TYPES.includes(type), `expected ${type} to be valid`);
  }
});

test('VALID_CUSTOM_REWARD_TYPES includes expected values', () => {
  assert.ok(VALID_CUSTOM_REWARD_TYPES.includes('ACCOUNT_CREDIT'));
  assert.ok(VALID_CUSTOM_REWARD_TYPES.includes('LOYALTY_POINTS'));
  assert.equal(VALID_CUSTOM_REWARD_TYPES.length, 2);
});

// Test the code-parsing logic used by upload-coupons --codes
function parseCodes(input) {
  return input.split(',').map(code => code.trim()).filter(Boolean);
}

test('upload-coupons --codes parses comma-separated codes', () => {
  const codes = parseCodes('CODE1,CODE2,CODE3');
  assert.deepEqual(codes, ['CODE1', 'CODE2', 'CODE3']);
});

test('upload-coupons --codes trims whitespace', () => {
  const codes = parseCodes(' CODE1 , CODE2 , CODE3 ');
  assert.deepEqual(codes, ['CODE1', 'CODE2', 'CODE3']);
});

test('upload-coupons --codes filters empty entries', () => {
  const codes = parseCodes('CODE1,,CODE2');
  assert.deepEqual(codes, ['CODE1', 'CODE2']);
});

// Test the file-parsing logic used by upload-coupons --file
function parseFileContents(contents) {
  return contents.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
}

test('upload-coupons --file parses one code per line', () => {
  const codes = parseFileContents('CODE1\nCODE2\nCODE3\n');
  assert.deepEqual(codes, ['CODE1', 'CODE2', 'CODE3']);
});

test('upload-coupons --file skips comment lines', () => {
  const codes = parseFileContents('# generated 2026-06-09\nCODE1\nCODE2');
  assert.deepEqual(codes, ['CODE1', 'CODE2']);
});

test('upload-coupons --file skips blank lines', () => {
  const codes = parseFileContents('CODE1\n\nCODE2\n  \nCODE3');
  assert.deepEqual(codes, ['CODE1', 'CODE2', 'CODE3']);
});
