import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printJson, printJsonText } from '../src/output.js';

function captureStdout(fn) {
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };
  try { fn(); } finally { process.stdout.write = orig; }
  return chunks.join('');
}

test('printJson outputs pretty JSON', () => {
  const out = captureStdout(() => printJson({ a: 1 }));
  assert.deepEqual(JSON.parse(out), { a: 1 });
});

test('printJson with compact strips nulls', () => {
  const out = captureStdout(() => printJson({ a: 1, b: null }, { compact: true }));
  const parsed = JSON.parse(out);
  assert.equal(parsed.a, 1);
  assert.ok(!('b' in parsed));
});

test('printJson with compact strips empty arrays', () => {
  const out = captureStdout(() => printJson({ a: 1, b: [] }, { compact: true }));
  const parsed = JSON.parse(out);
  assert.ok(!('b' in parsed));
});

test('printJson with compact strips empty objects', () => {
  const out = captureStdout(() => printJson({ a: 1, b: {} }, { compact: true }));
  const parsed = JSON.parse(out);
  assert.ok(!('b' in parsed));
});

test('printJson with compact is recursive', () => {
  const out = captureStdout(() => printJson({ a: { b: null, c: 2 } }, { compact: true }));
  const parsed = JSON.parse(out);
  assert.ok(!('b' in parsed.a));
  assert.equal(parsed.a.c, 2);
});

test('printJsonText parses and pretty-prints valid JSON', () => {
  const out = captureStdout(() => printJsonText('{"x":1}'));
  assert.deepEqual(JSON.parse(out), { x: 1 });
});

test('printJsonText passes through non-JSON text as-is', () => {
  const out = captureStdout(() => printJsonText('not json'));
  assert.equal(out.trim(), 'not json');
});
