import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmail, formatEventTime, formatEventDate, POLL_INTERVAL_MS, SEEN_MAX_SIZE, SEEN_KEEP_SIZE } from '../src/utils.js';

// isValidEmail
test('isValidEmail accepts a standard email', () => {
  assert.equal(isValidEmail('jane@example.com'), true);
});

test('isValidEmail accepts subdomains', () => {
  assert.equal(isValidEmail('jane@mail.example.com'), true);
});

test('isValidEmail rejects missing @', () => {
  assert.equal(isValidEmail('notanemail'), false);
});

test('isValidEmail rejects missing domain', () => {
  assert.equal(isValidEmail('jane@'), false);
});

test('isValidEmail rejects missing TLD', () => {
  assert.equal(isValidEmail('jane@example'), false);
});

test('isValidEmail rejects spaces', () => {
  assert.equal(isValidEmail('jane doe@example.com'), false);
});

test('isValidEmail rejects empty string', () => {
  assert.equal(isValidEmail(''), false);
});

// formatEventTime
test('formatEventTime returns a string', () => {
  assert.equal(typeof formatEventTime('2025-01-15T14:30:00Z'), 'string');
});

test('formatEventTime does not throw on valid ISO string', () => {
  assert.doesNotThrow(() => formatEventTime('2025-06-01T00:00:00Z'));
});

test('formatEventTime includes hour and minute components', () => {
  const result = formatEventTime('2025-01-15T14:30:45Z');
  assert.match(result, /\d{1,2}:\d{2}/);
});

// formatEventDate
test('formatEventDate returns a string', () => {
  assert.equal(typeof formatEventDate('2025-01-15T14:30:00Z'), 'string');
});

test('formatEventDate does not throw on valid ISO string', () => {
  assert.doesNotThrow(() => formatEventDate('2025-06-01T00:00:00Z'));
});

test('formatEventDate includes date and time components', () => {
  const result = formatEventDate('2025-01-15T14:30:00Z');
  assert.match(result, /\d{1,2}\/\d{1,2}\/\d{4}/); // date portion
  assert.match(result, /\d{1,2}:\d{2}/);             // time portion
});

// constants
test('POLL_INTERVAL_MS is a positive number', () => {
  assert.equal(typeof POLL_INTERVAL_MS, 'number');
  assert.ok(POLL_INTERVAL_MS > 0);
});

test('SEEN_MAX_SIZE is greater than SEEN_KEEP_SIZE', () => {
  assert.ok(SEEN_MAX_SIZE > SEEN_KEEP_SIZE);
});
