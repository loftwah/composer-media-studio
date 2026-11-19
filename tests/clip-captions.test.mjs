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

test('timing offset shifts cues before clipping and rebasing; default 0 keeps the original bytes', () => {
  const cues = [
    { startMs: 1000, endMs: 7000, text: 'A', speaker: '' },
    { startMs: 8000, endMs: 12000, text: 'B', speaker: '' },
  ];
  const base = serializeClipCaptions(cues, 2, 10);
  assert.equal(base, 'WEBVTT\n\n00:00.000 --> 00:05.000\nA\n\n00:06.000 --> 00:08.000\nB\n');
  assert.equal(serializeClipCaptions(cues, 2, 10, 0), base);
  // +1.5s moves every cue later: A is clipped at the top, B runs to the range end.
  assert.equal(serializeClipCaptions(cues, 2, 10, 1500), 'WEBVTT\n\n00:00.500 --> 00:06.500\nA\n\n00:07.500 --> 00:08.000\nB\n');
  // -1.5s moves every cue earlier: A ends sooner, B starts inside the range.
  assert.equal(serializeClipCaptions(cues, 2, 10, -1500), 'WEBVTT\n\n00:00.000 --> 00:03.500\nA\n\n00:04.500 --> 00:08.000\nB\n');
});
