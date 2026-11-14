import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSongTime } from '../src/frontend/song-time.ts';

test('song time accepts an explicit zero and millisecond precision', () => {
  assert.equal(parseSongTime('0'), 0);
  assert.equal(parseSongTime('0.000'), 0);
  assert.equal(parseSongTime('12.345'), 12345);
});
test('empty or invalid song times cannot become zero or overflow', () => {
  for (const input of ['', ' ', '-1', '1.2345', '1e2', '9007199254740993']) assert.equal(parseSongTime(input), null, input);
});
