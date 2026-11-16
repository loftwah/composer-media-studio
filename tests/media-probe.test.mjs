import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeMediaTrack } from '../src/frontend/media-probe.ts';

test('a parser refusal becomes the local tool message, not library text', async () => {
  await assert.rejects(
    probeMediaTrack(async () => { throw new Error('Input has an unsupported or unrecognizable format.'); }, 'audio'),
    /This browser cannot decode that audio file\./,
  );
  await assert.rejects(
    probeMediaTrack(async () => { throw new Error('Input has an unsupported or unrecognizable format.'); }, 'video'),
    /This browser cannot read that video\. Try another MP4 or WebM\./,
  );
});

test('a missing track stays missing and a readable track passes through', async () => {
  assert.equal(await probeMediaTrack(async () => null, 'video'), null);
  const track = { canDecode: async () => true };
  assert.equal(await probeMediaTrack(async () => track, 'audio'), track);
});
