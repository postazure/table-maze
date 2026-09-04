import { test } from 'node:test';
import assert from 'node:assert/strict';
import { key, parseKey, manhattan } from '../src/engine/types';

test('type helpers', () => {
  assert.equal(key({ x: 3, y: 4 }), '3,4');
  assert.deepEqual(parseKey('3,4'), { x: 3, y: 4 });
  assert.equal(manhattan({ x: 0, y: 0 }, { x: 2, y: 3 }), 5);
});
