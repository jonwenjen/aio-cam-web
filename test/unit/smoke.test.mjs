import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../../js/version.js';

test('VERSION is semver', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});
