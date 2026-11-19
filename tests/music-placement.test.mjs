// Focused checks for placing added audio on the video-time timeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { musicFadeDuration, musicPlacement } from '../src/frontend/music-fades.ts';

test('zero delay keeps the original overlap and fade envelope', () => {
  for (const [video, music, offset, fadeIn, fadeOut] of [[6, 10, 2, 1, 1], [4, 10, 2, 0, 0], [6, 4, 1, 1, 2]]) {
    const p = musicPlacement(video, music, offset, fadeIn, fadeOut, 0);
    assert.equal(p.overlap, musicFadeDuration(video, music, offset, fadeIn, fadeOut));
    assert.equal(p.start, 0);
    assert.equal(p.fadeInStart, 0);
    assert.equal(p.fadeInEnd, fadeIn);
    assert.equal(p.fadeOutStart, p.overlap - fadeOut);
    assert.equal(p.fadeOutEnd, p.overlap);
  }
});

test('a video-time opener shortens the overlap and shifts both fades', () => {
  assert.deepEqual(musicPlacement(6, 10, 2, 1, 1, 2), {
    start: 2, overlap: 4, fadeInStart: 2, fadeInEnd: 3, fadeOutStart: 5, fadeOutEnd: 6,
  });
  // The source trim remains independent of the opener.
  const trimmed = musicPlacement(6, 10, 8, 1, 1, 2);
  assert.equal(trimmed.overlap, 2);
  assert.equal(trimmed.fadeInEnd, 3);
  assert.equal(trimmed.fadeOutStart, 3);
  assert.equal(trimmed.fadeOutEnd, 4);
  // A short track can end the envelope before the video does.
  const short = musicPlacement(10, 5, 1, 1, 1, 2);
  assert.equal(short.overlap, 4);
  assert.equal(short.fadeOutStart, 5);
  assert.equal(short.fadeOutEnd, 6);
});

test('bad delays and too-long fades reject', () => {
  for (const delay of [-1, NaN, Infinity, 6, 7]) assert.throws(() => musicPlacement(6, 10, 2, 1, 1, delay));
  // Fades that fit at zero no longer fit once an opener is taken out.
  musicFadeDuration(4, 10, 0, 2, 2);
  assert.throws(() => musicPlacement(4, 10, 0, 2, 2, 1), /fades/i);
});
