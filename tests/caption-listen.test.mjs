import test from 'node:test';
import assert from 'node:assert/strict';
import { listenFromCaption } from '../src/frontend/caption-listen.ts';

test('rejects invalid timing and cancelled work before touching audio', async () => {
  const player = {};
  for (const time of [-1, 10000, NaN, 1.5]) await assert.rejects(listenFromCaption(player, time, 10000, new AbortController().signal), /Invalid caption start/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(listenFromCaption(player, 1000, 10000, controller.signal), { name: 'AbortError' });
});
