import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRequestBody } from '../src/commands/api.js';

test('describeRequestBody returns null when there is no request body', () => {
  assert.equal(describeRequestBody(null), null);
  assert.equal(describeRequestBody(undefined), null);
});

test('describeRequestBody returns flat properties for a plain JSON schema', () => {
  const schema = {
    properties: {
      email: { type: 'string', description: 'Person email' },
      count: { type: 'integer' },
    },
  };
  const result = describeRequestBody(schema);
  assert.equal(result.kind, 'properties');
  assert.deepEqual(result.fields, [
    { name: 'email', type: 'string', format: null, description: 'Person email' },
    { name: 'count', type: 'integer', format: null, description: null },
  ]);
});

test('describeRequestBody resolves a top-level $ref to its properties', () => {
  const schema = { $ref: '#/components/schemas/Thing' };
  const schemas = { Thing: { properties: { name: { type: 'string' } } } };
  const result = describeRequestBody(schema, schemas);
  assert.equal(result.kind, 'properties');
  assert.deepEqual(result.fields, [{ name: 'name', type: 'string', format: null, description: null }]);
});

test('describeRequestBody includes field format when present (e.g. multipart binary)', () => {
  const schema = { properties: { inputStream: { type: 'string', format: 'binary' } } };
  const result = describeRequestBody(schema);
  assert.equal(result.fields[0].format, 'binary');
});

test('describeRequestBody returns null for an empty properties object', () => {
  const schema = { properties: {} };
  assert.equal(describeRequestBody(schema), null);
});

test('describeRequestBody resolves oneOf variant titles from inline title, $ref, and allOf', () => {
  const schemas = {
    Referenced: { title: 'REFERENCED_VARIANT' },
    NoTitleHere: {},
  };
  const schema = {
    discriminator: { propertyName: 'algorithm' },
    oneOf: [
      { title: 'INLINE_TITLE' },
      { $ref: '#/components/schemas/Referenced' },
      { $ref: '#/components/schemas/NoTitleHere' },
      { allOf: [{ $ref: '#/components/schemas/Base' }, { title: 'ALLOF_TITLE' }] },
      { allOf: [{ $ref: '#/components/schemas/Base' }] },
    ],
  };
  const result = describeRequestBody(schema, schemas);
  assert.equal(result.kind, 'oneOf');
  assert.equal(result.variantCount, 5);
  assert.equal(result.discriminator, 'algorithm');
  // $ref-without-title falls back to the ref name; allOf-without-title is dropped entirely
  assert.deepEqual(result.titles, ['INLINE_TITLE', 'REFERENCED_VARIANT', 'NoTitleHere', 'ALLOF_TITLE']);
});

test('describeRequestBody reports oneOf with no discriminator as null, not a missing field', () => {
  const schema = { oneOf: [{ title: 'A' }, { title: 'B' }] };
  const result = describeRequestBody(schema);
  assert.equal(result.discriminator, null);
  assert.deepEqual(result.titles, ['A', 'B']);
});
