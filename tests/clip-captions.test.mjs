import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCaptionFile } from '../src/frontend/caption-import.ts';
import { captionReceiptFields, clipCaptionCues, clipCaptionSrtVariants, clipTimeStamp, serializeClipCaptions, sourceCaptionCues, sourcePreviewVtt, survivingClipCaptionCount, srtForClipVtt } from '../src/frontend/clip-captions.ts';
import { filterCuesByText } from '../src/frontend/clip-cue-search.ts';

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

test('the original-video preview spans the full source timebase at the draft offset', () => {
  const cues = [
    { startMs: 1000, endMs: 7000, text: 'A & B', speaker: '' },
    { startMs: 8000, endMs: 12000, text: '<Next>', speaker: '' },
  ];
  // No trim rebasing: cues keep their original source timestamps.
  assert.equal(sourcePreviewVtt(cues, 15, 0),
    'WEBVTT\n\n00:01.000 --> 00:07.000\nA &amp; B\n\n00:08.000 --> 00:12.000\n&lt;Next&gt;\n');
  // The draft offset moves cues on that same source timeline.
  assert.equal(sourcePreviewVtt(cues, 15, 1500),
    'WEBVTT\n\n00:02.500 --> 00:08.500\nA &amp; B\n\n00:09.500 --> 00:13.500\n&lt;Next&gt;\n');
  // Only the source duration clips a cue; invalid or missing timing yields no track.
  assert.equal(sourcePreviewVtt(cues, 9, 0),
    'WEBVTT\n\n00:01.000 --> 00:07.000\nA &amp; B\n\n00:08.000 --> 00:09.000\n&lt;Next&gt;\n');
  assert.equal(sourcePreviewVtt(cues, 15, null), null);
  assert.equal(sourcePreviewVtt(cues, 15, 61_000), null);
  assert.equal(sourcePreviewVtt(cues, 0, 0), null);
  assert.equal(sourcePreviewVtt(cues, Number.NaN, 0), null);
});

test('the original-video preview can place cues at Top without changing downloads or cue content', () => {
  const cues = [
    { startMs: 1000, endMs: 7000, text: 'A & B', speaker: '' },
    { startMs: 8000, endMs: 12000, text: '<Next>', speaker: '' },
  ];
  const base = sourcePreviewVtt(cues, 15, 0);
  assert.equal(base, 'WEBVTT\n\n00:01.000 --> 00:07.000\nA &amp; B\n\n00:08.000 --> 00:12.000\n&lt;Next&gt;\n');
  assert.equal(sourcePreviewVtt(cues, 15, 0, 'default'), base);
  const top = sourcePreviewVtt(cues, 15, 0, 'top');
  assert.equal(top, 'WEBVTT\n\n00:01.000 --> 00:07.000 line:12%\nA &amp; B\n\n00:08.000 --> 00:12.000 line:12%\n&lt;Next&gt;\n');
  // Only the cue setting differs: times, text and escaping come from the same
  // projection and serializer, so the shared parser sees the same cue set.
  assert.equal(top?.replaceAll(' line:12%', ''), base);
  assert.deepEqual(parseCaptionFile(top, 0, 15_000), parseCaptionFile(base, 0, 15_000));
  // Offset and source-duration clipping still apply in the top placement.
  assert.equal(sourcePreviewVtt(cues, 15, 1500, 'top'), 'WEBVTT\n\n00:02.500 --> 00:08.500 line:12%\nA &amp; B\n\n00:09.500 --> 00:13.500 line:12%\n&lt;Next&gt;\n');
  assert.equal(sourcePreviewVtt(cues, 9, 0, 'top'), 'WEBVTT\n\n00:01.000 --> 00:07.000 line:12%\nA &amp; B\n\n00:08.000 --> 00:09.000 line:12%\n&lt;Next&gt;\n');
  assert.equal(sourcePreviewVtt(cues, 15, null, 'top'), null);
  assert.equal(sourcePreviewVtt(cues, 15, 61_000, 'top'), null);
  assert.equal(sourcePreviewVtt(cues, 0, 0, 'top'), null);
  // Other callers take the default: no download, trim sidecar or export changes.
  assert.equal(serializeClipCaptions(cues, 0, 15), base);
  assert.equal(serializeClipCaptions(cues, 0, 15, 0, 'top'), top);
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

test('cue review rows expose trim-relative times and add trim start for original-video seeks', () => {
  const cues = [
    { startMs: 1000, endMs: 7000, text: 'A & B', speaker: '' },
    { startMs: 8000, endMs: 12000, text: '<Next>', speaker: '' },
  ];
  const trimmed = clipCaptionCues(cues, 2, 10, 1500);
  assert.deepEqual(trimmed, [
    { from: 500, to: 6500, sourceStartMs: 2500, text: 'A & B', speaker: '', sourceIndex: 0 },
    { from: 7500, to: 8000, sourceStartMs: 9500, text: '<Next>', speaker: '', sourceIndex: 1 },
  ]);
  assert.deepEqual(trimmed.map(cue => clipTimeStamp(cue.from)), ['00:00.500', '00:07.500']);
  // The same projection still backs the VTT and count.
  assert.equal(trimmed.length, survivingClipCaptionCount(cues, 2, 10, 1500));
  assert.equal(serializeClipCaptions(cues, 2, 10, 1500)?.split('\n\n').length, 3);
  // A cue already running before the trim is clamped to the trim start, so its
  // source seek includes the trim start rather than the earlier source time.
  const clipped = clipCaptionCues(cues, 2.0006, 10);
  assert.deepEqual(clipped?.[0], { from: 0, to: 4999, sourceStartMs: 2001, text: 'A & B', speaker: '', sourceIndex: 0 });
  const earlier = clipCaptionCues(cues, 2, 10, -1500);
  assert.deepEqual(earlier, [
    { from: 0, to: 3500, sourceStartMs: 2000, text: 'A & B', speaker: '', sourceIndex: 0 },
    { from: 4500, to: 8000, sourceStartMs: 6500, text: '<Next>', speaker: '', sourceIndex: 1 },
  ]);
  // Invalid values stay indistinguishable from the serializer's null result.
  assert.deepEqual(clipCaptionCues(cues, 12.5, 14), []);
  assert.equal(clipCaptionCues(cues, Number.NaN, 1), null);
  assert.equal(clipCaptionCues(cues, 2, 2), null);
  assert.equal(clipCaptionCues(cues, 2, 10, 61_000), null);
});

test('All source cues lists every stored cue at its unshifted original time and source index', () => {
  const cues = parseCaptionFile('WEBVTT\n\n00:00:00.500 --> 00:00:02.000\nBefore trim\n\n00:00:05.000 --> 00:00:08.000\nOutside the trim\n\n00:00:11.000 --> 00:00:12.500\nAfter\n', 0, 180_000);
  const rows = sourceCaptionCues(cues);
  assert.deepEqual(rows, [
    { startMs: 500, endMs: 2000, text: 'Before trim', speaker: '', sourceIndex: 0 },
    { startMs: 5000, endMs: 8000, text: 'Outside the trim', speaker: '', sourceIndex: 1 },
    { startMs: 11000, endMs: 12500, text: 'After', speaker: '', sourceIndex: 2 },
  ]);
  // A trim, clamp or offset can hide a cue from the in-trim list, but it can
  // never change or drop the matching source row.
  assert.deepEqual(clipCaptionCues(cues, 4, 9, 1000)?.map(cue => cue.sourceIndex), [1]);
  assert.deepEqual(clipCaptionCues(cues, 3.5, 4.5), []);
  assert.deepEqual(sourceCaptionCues(cues), rows);
  // The shared bounded search filters the source rows without rewriting them.
  const snapshot = structuredClone(rows);
  assert.deepEqual(filterCuesByText(rows, 'OUTSIDE').map(row => row.sourceIndex), [1]);
  assert.deepEqual(rows, snapshot);
  assert.deepEqual(sourceCaptionCues([]), []);
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
test('Video Clip voice output escapes and round-trips while unnamed bytes stay identical', () => {
  const cues = [
    { startMs: 1000, endMs: 2000, text: 'A & <B>', speaker: 'Dean & Jane' },
    { startMs: 2000, endMs: 3000, text: 'Unnamed', speaker: '' },
  ];
  const unnamed = 'WEBVTT\n\n00:01.000 --> 00:02.000\nA &amp; &lt;B&gt;\n\n00:02.000 --> 00:03.000\nUnnamed\n';
  assert.equal(serializeClipCaptions(cues, 0, 3), unnamed);
  const named = 'WEBVTT\n\n00:01.000 --> 00:02.000\n<v Dean &amp; Jane>A &amp; &lt;B&gt;</v>\n\n00:02.000 --> 00:03.000\nUnnamed\n';
  assert.equal(serializeClipCaptions(cues, 0, 3, 0, 'default', { voices: true }), named);
  assert.deepEqual(parseCaptionFile(named, 0, 3000, { voices: true }), cues);
  // Placement changes only the cue setting; the voice body is shared.
  assert.equal(sourcePreviewVtt(cues, 3, 0, 'top', { voices: true }),
    'WEBVTT\n\n00:01.000 --> 00:02.000 line:12%\n<v Dean &amp; Jane>A &amp; &lt;B&gt;</v>\n\n00:02.000 --> 00:03.000 line:12%\nUnnamed\n');
  // An invalid internal name is refused rather than emitted or silently dropped.
  assert.equal(serializeClipCaptions([{ ...cues[0], speaker: 'x'.repeat(81) }], 0, 3, 0, 'default', { voices: true }), null);
  assert.equal(serializeClipCaptions([{ ...cues[0], speaker: 'Two\nlines' }], 0, 3, 0, 'default', { voices: true }), null);
});
test('cue review projections keep a supplied speaker separate from the words', () => {
  const cues = [{ startMs: 1000, endMs: 2000, text: 'A & B', speaker: 'Dean' }];
  assert.deepEqual(clipCaptionCues(cues, 0, 3), [
    { from: 1000, to: 2000, sourceStartMs: 1000, text: 'A & B', speaker: 'Dean', sourceIndex: 0 },
  ]);
  assert.deepEqual(sourceCaptionCues(cues), [
    { startMs: 1000, endMs: 2000, text: 'A & B', speaker: 'Dean', sourceIndex: 0 },
  ]);
});
test('SRT is withheld for named cues instead of silently dropping the speaker', () => {
  const named = { startMs: 0, endMs: 1000, text: 'Hi', speaker: 'Dean' };
  const namedVtt = serializeClipCaptions([named], 0, 1, 0, 'default', { voices: true });
  assert.equal(srtForClipVtt(namedVtt, 1000), null);
  // The prior unnamed SRT stays byte-identical.
  const unnamedVtt = serializeClipCaptions([{ ...named, speaker: '' }], 0, 1);
  assert.equal(srtForClipVtt(unnamedVtt, 1000), '1\n00:00:00,000 --> 00:00:01,000\nHi\n');
});
test('the speaker-name-as-text SRT folds named cues, keeps unnamed bytes and exact times', () => {
  const cues = [
    { startMs: 0, endMs: 1000, text: 'Hello & <there>', speaker: 'Dean & <Jane>' },
    { startMs: 1200, endMs: 2500, text: 'Unnamed & <plain>', speaker: '' },
  ];
  const vtt = serializeClipCaptions(cues, 0, 3, 0, 'default', { voices: true });
  const variants = clipCaptionSrtVariants(vtt, 3000);
  assert.equal(variants.named, true);
  assert.equal(variants.plain, null);
  assert.equal(variants.speakerText, '1\n00:00:00,000 --> 00:00:01,000\nDean & &lt;Jane&gt;: Hello & &lt;there&gt;\n\n2\n00:00:01,200 --> 00:00:02,500\nUnnamed & &lt;plain&gt;\n');
  // The combined line and relative times survive the same bounded parser.
  assert.deepEqual(parseCaptionFile(variants.speakerText, 0, 3000), [
    { startMs: 0, endMs: 1000, text: 'Dean & <Jane>: Hello & <there>', speaker: '' },
    { startMs: 1200, endMs: 2500, text: 'Unnamed & <plain>', speaker: '' },
  ]);
  // The legacy strict default is unchanged; the opt-in reuses the same parse.
  assert.equal(srtForClipVtt(vtt, 3000), null);
  assert.equal(srtForClipVtt(vtt, 3000, { speakerText: true }), variants.speakerText);
});
test('an unnamed export keeps its exact plain SRT and offers no speaker variant', () => {
  const vtt = serializeClipCaptions([{ startMs: 0, endMs: 1000, text: 'A & <B>', speaker: '' }], 0, 1);
  const variants = clipCaptionSrtVariants(vtt, 1000);
  assert.equal(variants.named, false);
  assert.equal(variants.plain, '1\n00:00:00,000 --> 00:00:01,000\nA & &lt;B&gt;\n');
  assert.equal(variants.speakerText, null);
  assert.equal(srtForClipVtt(vtt, 1000), variants.plain);
  assert.equal(srtForClipVtt(vtt, 1000, { speakerText: true }), variants.plain);
});
test('a trim that excludes every named cue keeps the unchanged plain SRT', () => {
  const cues = [
    { startMs: 0, endMs: 1000, text: 'Named outside', speaker: 'Dean' },
    { startMs: 2000, endMs: 3000, text: 'Unnamed inside', speaker: '' },
  ];
  const vtt = serializeClipCaptions(cues, 2, 3, 0, 'default', { voices: true });
  const variants = clipCaptionSrtVariants(vtt, 1000);
  assert.equal(variants.named, false);
  assert.equal(variants.plain, '1\n00:00:00,000 --> 00:00:01,000\nUnnamed inside\n');
  assert.equal(variants.speakerText, null);
});
test('a speaker prefix that pushes a cue line over the text bound keeps WebVTT only', () => {
  const vtt = serializeClipCaptions([{ startMs: 0, endMs: 1000, text: 'x'.repeat(300), speaker: 'Dean' }], 0, 1, 0, 'default', { voices: true });
  const variants = clipCaptionSrtVariants(vtt, 1000);
  assert.equal(variants.named, true);
  assert.equal(variants.plain, null);
  assert.equal(variants.speakerText, null);
  assert.equal(srtForClipVtt(vtt, 1000, { speakerText: true }), null);
});
test('a multibyte speaker-text SRT over 64 KiB is withheld even when every line is short', () => {
  const cues = Array.from({ length: 100 }, (_, index) => ({
    startMs: index * 1000,
    endMs: index * 1000 + 900,
    text: '漢'.repeat(296),
    speaker: 'S',
  }));
  const vtt = serializeClipCaptions(cues, 0, 100, 0, 'default', { voices: true });
  const variants = clipCaptionSrtVariants(vtt, 100_000);
  assert.equal(variants.named, true);
  assert.equal(variants.speakerText, null);
});
