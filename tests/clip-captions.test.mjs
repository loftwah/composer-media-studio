import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCaptionFile } from '../src/frontend/caption-import.ts';
import { captionReceiptFields, serializeClipCaptions, survivingClipCaptionCount, srtForClipVtt } from '../src/frontend/clip-captions.ts';

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

test('the preflight count uses the same clamp/offset/filter projection as serialization', () => {
  const cues = [
    { startMs: 1000, endMs: 7000, text: 'A', speaker: '' },
    { startMs: 8000, endMs: 12000, text: 'B', speaker: '' },
  ];
  for (const offset of [0, 1500, -1500, 6000, -6000]) {
    const vtt = serializeClipCaptions(cues, 2, 10, offset);
    assert.equal(survivingClipCaptionCount(cues, 2, 10, offset), vtt ? vtt.split('\n\n').length - 1 : 0);
  }
  // Valid values with no surviving cues report zero; invalid values are omitted.
  assert.equal(survivingClipCaptionCount(cues, 12.5, 14), 0);
  assert.equal(serializeClipCaptions(cues, 12.5, 14), null);
  assert.equal(survivingClipCaptionCount(cues, Number.NaN, 1), null);
  assert.equal(survivingClipCaptionCount(cues, 2, 2), null);
  assert.equal(survivingClipCaptionCount(cues, 2, 10, 61_000), null);
});

test('a caption receipt carries the source digest and offset but never cue text', () => {
  const caption = { name: 'watch.vtt', sourceSha256: 'd'.repeat(64), vtt: 'WEBVTT\n\n00:00.000 --> 00:01.000\nPrivate line\n' };
  assert.deepEqual(captionReceiptFields(caption, 0), {
    sourceName: 'watch.vtt', included: true, sourceSha256: 'd'.repeat(64),
  });
  assert.deepEqual(captionReceiptFields(caption, -1500), {
    sourceName: 'watch.vtt', included: true, sourceSha256: 'd'.repeat(64), offsetMs: -1500,
  });
  assert.equal(captionReceiptFields({ ...caption, vtt: null }, 0).included, false);
  assert.doesNotMatch(JSON.stringify(captionReceiptFields(caption, 1500)), /Private line/);
});

test('the SRT sidecar reuses the importer to reproduce exact relative times and plain text', () => {
  const cues = parseCaptionFile('1\n00:00:00,500 --> 00:00:02,000\nA & B\n\n2\n00:00:02,100 --> 00:00:05,200\n&lt;Next&gt;\n', 0, 180_000);
  const vtt = serializeClipCaptions(cues, 1, 4);
  assert.equal(srtForClipVtt(vtt, 3000), '1\n00:00:00,000 --> 00:00:01,000\nA & B\n\n2\n00:00:01,100 --> 00:00:03,000\n&lt;Next&gt;\n');
  // The SRT reparses through the same parser to the identical cue set/timeline.
  assert.deepEqual(parseCaptionFile(srtForClipVtt(vtt, 3000), 0, 3000), parseCaptionFile(vtt, 0, 3000));
});

test('the reviewed clip cue set survives into SRT with line hints and multi-line cues', () => {
  const vtt = 'WEBVTT\n\n00:00.000 --> 00:00.600 line:12%\n[A sharp click]\n\n00:00.600 --> 00:02.050 line:12%\nBring your AI agent.\n\n00:02.050 --> 00:03.650 line:12%\nBuild an app.\n\n00:03.850 --> 00:05.000 line:12%\n[Power-up chime]\nTake it with you.\n';
  assert.equal(srtForClipVtt(vtt, 5000), '1\n00:00:00,000 --> 00:00:00,600\n[A sharp click]\n\n2\n00:00:00,600 --> 00:00:02,050\nBring your AI agent.\n\n3\n00:00:02,050 --> 00:00:03,650\nBuild an app.\n\n4\n00:00:03,850 --> 00:00:05,000\n[Power-up chime] Take it with you.\n');
});

test('no SRT is exposed when the shared parser cannot cleanly preserve the source', () => {
  for (const vtt of [
    'WEBVTT\n\n00:00.000 --> 00:01.000\nHello &copy; world\n', // unsupported entity
    'WEBVTT\n\n00:00.000 --> 00:01.000\n<b>styled</b>\n', // markup
    'WEBVTT\n\n00:00.000 --> 00:01.000\nA\n\n00:00.500 --> 00:02.000\nB\n', // overlap
    'WEBVTT\n\n00:00.000 --> 00:06.000\nToo long\n', // outside the segment
  ]) assert.equal(srtForClipVtt(vtt, 5000), null);
  // Text the shared parser cannot round-trip through SRT is withheld, not rebuilt.
  assert.equal(srtForClipVtt('WEBVTT\n\n00:00.000 --> 00:01.000\nSearch &amp;lt; here\n', 5000), null);
  assert.equal(srtForClipVtt(null, 5000), null);
  assert.equal(srtForClipVtt('WEBVTT\n\n00:00.000 --> 00:01.000\nA\n', 0), null);
});
