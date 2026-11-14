import { test } from 'node:test';
import assert from 'node:assert/strict';
import { musicFadeDuration } from '../src/frontend/music-fades.ts';
test('music fades fit the audible portion after the selected offset', () => {
  assert.equal(musicFadeDuration(4, 10, 2, 0, 0), 4);
  assert.equal(musicFadeDuration(6, 4, 1, 1, 2), 3);
  for (const [video,music,offset,a,b] of [[3,3,0,2,2],[3,4,3,0,1.1],[3,4,4,0,0],[3,4,0,-1,0],[3,4,0,NaN,0]]) assert.throws(() => musicFadeDuration(video,music,offset,a,b));
});
