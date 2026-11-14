import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSongTime } from '../src/frontend/song-time.ts';

test('song time accepts explicit zero, decimals and exponent notation at millisecond precision', () => {
  for (const [input, expected] of [['0',0], ['0.000',0], ['.5',500], ['2.',2000], ['12.345',12345], ['1e2',100000], ['5e-1',500], ['1.0000',1000], ['0e999999',0], ['9007199254740.991', Number.MAX_SAFE_INTEGER]]) assert.equal(parseSongTime(input), expected, input);
});
test('empty, negative, sub-millisecond, malformed or unsafe times are rejected', () => {
  for (const input of ['', ' ', '-1', '-0', '1.2345', '.0001', '1e-4', '2e', 'NaN', '9007199254740.992', '1e1000']) assert.equal(parseSongTime(input), null, input);
});
