import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCaptionFile } from '../src/frontend/caption-import.ts';
import { serializeClipCaptions } from '../src/frontend/clip-captions.ts';

test('imported caption cues are trimmed, rebased and escaped as plain WebVTT', () => {
  const cues = parseCaptionFile('1\n00:00:00,500 --> 00:00:02,000\nA & B\n\n2\n00:00:02,100 --> 00:00:05,200\n&lt;Next&gt;\n', 0, 180_000);
  assert.equal(serializeClipCaptions(cues, 1, 4), 'WEBVTT\n\n00:00.000 --> 00:01.000\nA &amp; B\n\n00:01.100 --> 00:03.000\n&lt;Next&gt;\n');
  assert.equal(serializeClipCaptions(cues, 2, 2.1), null);
  assert.equal(serializeClipCaptions(cues, 5.2, 7), null);
  assert.equal(serializeClipCaptions(cues, Number.NaN, 1), null);
});
