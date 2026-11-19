// Mix settings are local data: these checks cover reopening a v1 receipt
// against the exact selected source bytes, without fetch, upload or export.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_MIX_SETTINGS_BYTES, parseMixSettings } from '../src/frontend/mix-settings.ts';

const sha = 'a'.repeat(64);
const proof = {
  videoBytes: 1000, videoSha256: sha, audioBytes: 2000, audioSha256: sha,
  videoSeconds: 10, audioSeconds: 20,
};
const receipt = () => ({
  schema: 'media-studio/add-music-mix-settings',
  version: 1,
  video: { bytes: 1000, sha256: sha },
  audio: { bytes: 2000, sha256: sha },
  mix: { delay: 1, offset: 2, gain: 80, originalGain: 0, fadeIn: 1, fadeOut: 1, quality: 'standard' },
});
const text = (value = receipt()) => JSON.stringify(value);
const fails = (value = receipt(), currentProof = proof) =>
  assert.throws(() => parseMixSettings(text(value), currentProof));

test('a matching v1 receipt restores only the editable mix controls', () => {
  assert.deepEqual(parseMixSettings(text(), proof), receipt().mix);
});

test('different source bytes, malformed input or wrong schema is rejected', () => {
  const otherVideo = receipt(); otherVideo.video.sha256 = 'b'.repeat(64); fails(otherVideo);
  const otherAudio = receipt(); otherAudio.audio.bytes = 2001; fails(otherAudio);
  assert.throws(() => parseMixSettings('{not json', proof));
  const wrongVersion = receipt(); wrongVersion.version = 2; fails(wrongVersion);
  assert.throws(() => parseMixSettings('x'.repeat(MAX_MIX_SETTINGS_BYTES + 1), proof));
});

test('finite ranges, gains, fades and placement are bounded by the chosen files', () => {
  for (const change of [
    { delay: -1 }, { delay: Number.NaN }, { delay: 10 },
    { offset: -1 }, { offset: 20 }, { offset: Number.POSITIVE_INFINITY },
    { gain: 101 }, { originalGain: -1 }, { fadeIn: -1 },
    { fadeOut: Number.NaN }, { quality: '4k' },
    { fadeIn: 8, fadeOut: 2, delay: 1 }, // fades overflow an opener-shortened overlap
  ]) {
    const value = receipt(); Object.assign(value.mix, change); fails(value);
  }
  assert.deepEqual(parseMixSettings(text(), { ...proof, videoSeconds: 12 }), receipt().mix);
});
