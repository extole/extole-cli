import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, printDiff } from '../src/utils.js';

test('diffLines: identical text is all "same"', () => {
  const hunks = diffLines('a\nb\nc', 'a\nb\nc');
  assert.deepEqual(hunks, [
    { type: 'same', line: 'a' },
    { type: 'same', line: 'b' },
    { type: 'same', line: 'c' },
  ]);
});

test('diffLines: single line changed reports del + add around unchanged context', () => {
  const hunks = diffLines('a\nb\nc', 'a\nx\nc');
  assert.deepEqual(hunks, [
    { type: 'same', line: 'a' },
    { type: 'del', line: 'b' },
    { type: 'add', line: 'x' },
    { type: 'same', line: 'c' },
  ]);
});

test('diffLines: appended lines show up as trailing adds', () => {
  const hunks = diffLines('a', 'a\nb\nc');
  assert.deepEqual(hunks, [
    { type: 'same', line: 'a' },
    { type: 'add', line: 'b' },
    { type: 'add', line: 'c' },
  ]);
});

test('diffLines: removed lines show up as dels', () => {
  const hunks = diffLines('a\nb\nc', 'a');
  assert.deepEqual(hunks, [
    { type: 'same', line: 'a' },
    { type: 'del', line: 'b' },
    { type: 'del', line: 'c' },
  ]);
});

test('diffLines: empty old text is all adds', () => {
  const hunks = diffLines('', 'a\nb');
  assert.deepEqual(hunks, [
    { type: 'del', line: '' },
    { type: 'add', line: 'a' },
    { type: 'add', line: 'b' },
  ]);
});

test('printDiff prefixes same/del/add lines correctly', () => {
  const logged = [];
  const originalLog = console.log;
  console.log = (line) => logged.push(line);
  try {
    printDiff('a\nb', 'a\nx');
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(logged, ['  a', '- b', '+ x']);
});
