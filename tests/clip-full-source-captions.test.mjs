import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCaptionFile } from '../src/frontend/caption-import.ts';
import { serializeClipCaptions, sourcePreviewVtt, srtForClipVtt } from '../src/frontend/clip-captions.ts';
import { fullSourceCaptionDownload, fullSourceCaptionSrt } from '../src/frontend/clip-full-source-captions.ts';
import { manualCaptionTrackVtt } from '../src/frontend/clip-manual-cue.ts';
import { MAX_PUBLIC_VIDEO_SOURCE_SECONDS } from '../src/frontend/video-clip-source.ts';

const cue = (startMs, endMs, text) => ({ startMs, endMs, text, speaker: '' });

test('the full-source draft keeps every original cue time and text, including cues outside the trim', () => {
  const cues = [
    cue(500, 1800, 'Before & <early>'),
    cue(2500, 4200, 'Inside'),
    cue(6100, 7800, 'After'),
  ];
  const full = fullSourceCaptionDownload(cues);
  assert.deepEqual(full, {
    vtt: 'WEBVTT\n\n00:00.500 --> 00:01.800\nBefore &amp; &lt;early&gt;\n\n00:02.500 --> 00:04.200\nInside\n\n00:06.100 --> 00:07.800\nAfter\n',
  });
  // It is the existing canonical full-source serializer, not a second one.
  assert.equal(full.vtt, manualCaptionTrackVtt(cues));
  // A trimmed draft export drops the outside cues and rebases what remains.
  const trimmed = serializeClipCaptions(cues, 3, 5);
  assert.notEqual(full.vtt, trimmed);
  assert.doesNotMatch(trimmed, /Before|After/);
  // The timing offset is an independent setting: it changes the preview and the
  // trimmed export, but never the full-source file.
  assert.equal(full.vtt, sourcePreviewVtt(cues, 10, 0));
  assert.notEqual(full.vtt, sourcePreviewVtt(cues, 10, 1500));
});

test('the full-source VTT re-imports through the same Choose captions bounds with identical cues', () => {
  const cues = [
    cue(500, 1800, 'Before & <early>'),
    cue(2500, 4200, 'Inside'),
    cue(6100, 7800, 'After'),
  ];
  const full = fullSourceCaptionDownload(cues);
  assert.ok('vtt' in full);
  assert.deepEqual(parseCaptionFile(full.vtt, 0, MAX_PUBLIC_VIDEO_SOURCE_SECONDS * 1000), cues);
});

test('the full-source SRT keeps every original-time cue, including ones outside the trim', () => {
  const cues = [
    cue(500, 1800, 'Before & <early>'),
    cue(2500, 4200, 'Inside'),
    cue(6100, 7800, 'After'),
  ];
  const full = fullSourceCaptionDownload(cues);
  assert.ok('vtt' in full);
  const srt = fullSourceCaptionSrt(full.vtt);
  assert.equal(srt, '1\n00:00:00,500 --> 00:00:01,800\nBefore & &lt;early&gt;\n\n2\n00:00:02,500 --> 00:00:04,200\nInside\n\n3\n00:00:06,100 --> 00:00:07,800\nAfter\n');
  assert.deepEqual(parseCaptionFile(srt, 0, MAX_PUBLIC_VIDEO_SOURCE_SECONDS * 1000), cues);
  // It is the full-source timeline, not the trimmed SRT the receipt exposes.
  assert.notEqual(srt, srtForClipVtt(serializeClipCaptions(cues, 3, 5), 2000));
});

test('an SRT that cannot round-trip is withheld while the full-source VTT stays valid', () => {
  const cues = [cue(0, 1000, 'Search &lt; here')];
  const full = fullSourceCaptionDownload(cues);
  assert.ok('vtt' in full);
  assert.deepEqual(parseCaptionFile(full.vtt, 0, MAX_PUBLIC_VIDEO_SOURCE_SECONDS * 1000), cues);
  assert.equal(fullSourceCaptionSrt(full.vtt), null);
  assert.equal(fullSourceCaptionSrt(null), null);
});

test('a canonical draft over 64 KB returns an accurate message instead of a download', () => {
  const cues = Array.from({ length: 100 }, (_, index) =>
    cue(index * 1000, index * 1000 + 900, '&'.repeat(300)));
  const full = fullSourceCaptionDownload(cues);
  assert.ok('problem' in full);
  assert.match(full.problem, /over the 64 KB limit/);
  assert.match(full.problem, /can’t be chosen again/);
});

test('a draft the bounded importer cannot reproduce is refused, and no cues means no action', () => {
  const unreadable = fullSourceCaptionDownload([cue(0, 1000, 'Two\nlines')]);
  assert.ok('problem' in unreadable);
  assert.match(unreadable.problem, /could not be saved as WebVTT/);
  assert.equal(fullSourceCaptionDownload([]), null);
});

test('the full-source VTT keeps a voice speaker and withholds SRT instead of dropping it', () => {
  const named = [{ startMs: 0, endMs: 1000, text: 'Hello & <there>', speaker: 'Dean & Jane' }];
  const full = fullSourceCaptionDownload(named);
  assert.deepEqual(full, {
    vtt: 'WEBVTT\n\n00:00.000 --> 00:01.000\n<v Dean &amp; Jane>Hello &amp; &lt;there&gt;</v>\n',
  });
  assert.ok('vtt' in full);
  assert.deepEqual(parseCaptionFile(full.vtt, 0, MAX_PUBLIC_VIDEO_SOURCE_SECONDS * 1000, { voices: true }), named);
  assert.equal(fullSourceCaptionSrt(full.vtt), null);
});
