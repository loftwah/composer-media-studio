import test from 'node:test';
import assert from 'node:assert/strict';
import { listenFromCaption } from '../src/frontend/caption-listen.ts';

test('listens from the original song time without changing caption data', async () => {
  let calls = 0;
  const player = { currentTime: 0, play: async () => { calls++; } };
  await listenFromCaption(player, 3250, 10000);
  assert.equal(player.currentTime, 3.25);
  assert.equal(calls, 1);
});
test('rejects out-of-range starts and propagates playback failures', async () => {
  const player = { currentTime: 0, play: async () => { throw new Error('blocked'); } };
  for (const time of [-1, 10000, NaN, 1.5]) await assert.rejects(listenFromCaption(player, time, 10000), /Invalid caption start/);
  await assert.rejects(listenFromCaption(player, 1000, 10000), /blocked/);
});
