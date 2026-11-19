import test from 'node:test';
import assert from 'node:assert/strict';
import { listenFromCaption } from '../src/frontend/caption-listen.ts';

const settle = () => new Promise(resolve => setImmediate(resolve));

function fakePlayer() {
  const listeners = new Map();
  const pauses = [];
  const player = {
    readyState: 1, duration: 10, currentTime: 0, seeking: false, paused: true,
    seekable: { length: 1, start: () => 0, end: () => 10 },
    load() {}, play() { player.paused = false; return Promise.resolve(); },
    pause() { player.paused = true; pauses.push(player.currentTime); },
    addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    emit(type) { for (const handler of [...(listeners.get(type) ?? [])]) handler({ target: player }); },
  };
  return { player, pauses };
}

test('rejects invalid timing and cancelled work before touching audio', async () => {
  const player = {};
  for (const time of [-1, 10000, NaN, 1.5]) await assert.rejects(listenFromCaption(player, time, 10000, new AbortController().signal), /Invalid caption start/);
  for (const end of [500, 1000, 10001, NaN, 2.5]) await assert.rejects(listenFromCaption(player, 1000, 10000, new AbortController().signal, end), /Invalid caption end/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(listenFromCaption(player, 1000, 10000, controller.signal), { name: 'AbortError' });
});

test('stops at the caption end and cleans up after the bounded audition', async () => {
  const { player, pauses } = fakePlayer();
  const running = listenFromCaption(player, 1000, 10000, new AbortController().signal, 2500);
  await settle();
  player.currentTime = 2.6;
  player.emit('timeupdate');
  await running;
  assert.deepEqual(pauses, [2.6]);
  player.emit('pause');
  player.currentTime = 9;
  player.emit('timeupdate');
  assert.deepEqual(pauses, [2.6]);
});

test('a manual seek or pause ends the audition without jumping back', async () => {
  const sought = fakePlayer();
  const seeking = listenFromCaption(sought.player, 1000, 10000, new AbortController().signal, 2500);
  await settle();
  sought.player.currentTime = 4.2;
  sought.player.emit('seeking');
  await seeking;
  assert.deepEqual(sought.pauses, []);
  const stopped = fakePlayer();
  const pausing = listenFromCaption(stopped.player, 1000, 10000, new AbortController().signal, 2500);
  await settle();
  stopped.player.paused = true;
  stopped.player.emit('pause');
  await pausing;
  assert.deepEqual(stopped.pauses, []);
});

test('an abort or song end releases the bounded audition', async () => {
  const controller = new AbortController();
  const { player, pauses } = fakePlayer();
  const aborting = listenFromCaption(player, 1000, 10000, controller.signal, 2500);
  await settle();
  controller.abort();
  await assert.rejects(aborting, { name: 'AbortError' });
  assert.deepEqual(pauses, [1]);
  const ending = fakePlayer();
  const song = listenFromCaption(ending.player, 1000, 10000, new AbortController().signal, 2500);
  await settle();
  ending.player.emit('ended');
  await song;
  assert.deepEqual(ending.pauses, []);
});

test('without an end the existing unbounded playback keeps working', async () => {
  const { player, pauses } = fakePlayer();
  await listenFromCaption(player, 1000, 10000, new AbortController().signal);
  assert.deepEqual(pauses, []);
  assert.equal(player.currentTime, 1);
});
