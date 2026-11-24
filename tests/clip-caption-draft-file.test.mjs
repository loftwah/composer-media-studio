// The caption draft JSON is a local, data-only sidecar. These checks cover the
// one versioned format, exact source fingerprint, canonical full-source cues
// and the refusals a caller relies on to keep its working draft unchanged.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAPTION_DRAFT_SCHEMA,
  CAPTION_DRAFT_VERSION,
  MAX_CAPTION_DRAFT_BYTES,
  captionDraftFileText,
  parseCaptionDraftFile,
} from '../src/frontend/clip-caption-draft-file.ts';
import { MAX_CAPTION_BYTES, MAX_CAPTION_OFFSET_SECONDS } from '../src/frontend/clip-captions.ts';
import { manualCaptionTrackVtt } from '../src/frontend/clip-manual-cue.ts';

const cue = (startMs, endMs, text) => ({ startMs, endMs, text, speaker: '' });
const source = { bytes: 123_456, sha256: 'a'.repeat(64) };
const cues = [
  cue(500, 1800, 'Before & <early>'),
  cue(2500, 4200, 'Inside'),
  cue(6100, 7800, 'After'),
];
const saved = (offsetMs = 1500, list = cues, fingerprint = source) => {
  const result = captionDraftFileText(fingerprint, list, offsetMs);
  assert.ok('text' in result, JSON.stringify(result));
  return result;
};
const payload = (offsetMs = 1500, fingerprint = source) => {
  const { text } = saved(offsetMs, cues, fingerprint);
  return JSON.parse(text);
};
const textOf = (value) => JSON.stringify(value);
const fails = (mutate, message) => {
  const value = payload();
  mutate(value);
  assert.throws(() => parseCaptionDraftFile(textOf(value), source), message);
};

test('a v1 draft saves every canonical cue at its original time plus the selected offset', () => {
  const { text, bytes } = saved(1500);
  const value = JSON.parse(text);
  assert.equal(value.schema, CAPTION_DRAFT_SCHEMA);
  assert.equal(value.version, CAPTION_DRAFT_VERSION);
  assert.deepEqual(value.source, source);
  assert.equal(value.captions.offsetMs, 1500);
  // The timing offset is a separate setting and never shifts the saved cues.
  assert.equal(value.captions.vtt, manualCaptionTrackVtt(cues));
  assert.match(value.captions.vtt, /00:00\.500 --> 00:01\.800/);
  assert.equal(bytes, new TextEncoder().encode(text).length);
  assert.deepEqual(parseCaptionDraftFile(text, source), { cues, offsetMs: 1500 });
});

test('zero and negative offsets round-trip through the same bounded field', () => {
  for (const offsetMs of [0, -1500, -MAX_CAPTION_OFFSET_SECONDS * 1000, MAX_CAPTION_OFFSET_SECONDS * 1000]) {
    const { text } = saved(offsetMs);
    assert.deepEqual(parseCaptionDraftFile(text, source), { cues, offsetMs });
    assert.equal(JSON.parse(text).captions.offsetMs, offsetMs);
  }
});

test('a different video byte length or SHA-256 is refused before cues are returned', () => {
  const { text } = saved();
  assert.throws(() => parseCaptionDraftFile(text, { ...source, bytes: source.bytes + 1 }), /different source bytes/);
  assert.throws(() => parseCaptionDraftFile(text, { ...source, sha256: 'b'.repeat(64) }), /different video/);
  // A malformed claim or an unusable proof cannot be checked at all.
  assert.throws(() => parseCaptionDraftFile(text, { ...source, sha256: 'A'.repeat(64) }), /no usable fingerprint/);
  assert.throws(() => parseCaptionDraftFile(text, { ...source, bytes: 0 }), /no usable fingerprint/);
});

test('malformed size, JSON, schema and version payloads are refused', () => {
  assert.throws(() => parseCaptionDraftFile('{not json', source), /not valid JSON/);
  assert.throws(() => parseCaptionDraftFile('x'.repeat(MAX_CAPTION_DRAFT_BYTES + 1), source), /under 128 KB/);
  fails(value => { value.schema = 'media-studio/other'; }, /caption draft v1/);
  fails(value => { value.version = 2; }, /caption draft v1/);
  fails(value => { delete value.source; }, /source description/);
  fails(value => { value.source.bytes = 0; }, /source description/);
  fails(value => { delete value.captions; }, /no editable captions/);
});

test('field and timing-offset validation runs before any restore', () => {
  const bound = MAX_CAPTION_OFFSET_SECONDS * 1000;
  for (const offsetMs of [bound + 1, -bound - 1, 1.5, '1.5', null, undefined]) {
    fails(value => { value.captions.offsetMs = offsetMs; }, /timing offset/);
  }
  fails(value => { value.captions.vtt = ''; }, /no caption file/);
  fails(value => { value.captions.vtt = 7; }, /no caption file/);
  fails(value => { value.captions.vtt = 'x'.repeat(MAX_CAPTION_BYTES + 1); }, /over the 64 KB import limit/);
});

test('the saved VTT must re-import under the existing bounds and stay canonical', () => {
  fails(value => { value.captions.vtt = 'not a caption file'; }, /not valid SRT or WebVTT/);
  // Valid WebVTT that is not the exact canonical full-source form is refused.
  fails(value => { value.captions.vtt = value.captions.vtt.replace(/\n$/, ''); }, /not the canonical full-source WebVTT/);
  // A cue over the existing three-minute import bound cannot be saved either.
  const tooLate = captionDraftFileText(source, [cue(0, 181_000, 'Late')], 0);
  assert.ok('problem' in tooLate);
  assert.match(tooLate.problem, /could not be saved as WebVTT/);
});

test('a named cue keeps its voice speaker through the existing v1 JSON draft', () => {
  const named = [{ startMs: 500, endMs: 1800, text: 'Hello & <there>', speaker: 'Dean & Jane' }];
  const { text } = saved(0, named);
  assert.equal(JSON.parse(text).captions.vtt,
    'WEBVTT\n\n00:00.500 --> 00:01.800\n<v Dean &amp; Jane>Hello &amp; &lt;there&gt;</v>\n');
  assert.deepEqual(parseCaptionDraftFile(text, source), { cues: named, offsetMs: 0 });
  // An existing unnamed v1 draft keeps the same schema, bytes and cues.
  const legacy = saved(0);
  assert.doesNotMatch(JSON.parse(legacy.text).captions.vtt, /<v /);
  assert.deepEqual(parseCaptionDraftFile(legacy.text, source), { cues, offsetMs: 0 });
});

test('saving refuses no cues, an unusable fingerprint, a bad offset and an oversized track', () => {
  assert.deepEqual(captionDraftFileText(source, [], 0), { problem: 'There are no caption cues to save in a draft.' });
  assert.match(captionDraftFileText({ ...source, bytes: 0 }, cues, 0).problem, /no usable fingerprint/);
  assert.match(captionDraftFileText({ ...source, sha256: 'short' }, cues, 0).problem, /no usable fingerprint/);
  assert.match(captionDraftFileText(source, cues, 1.5).problem, /whole milliseconds/);
  assert.match(captionDraftFileText(source, cues, MAX_CAPTION_OFFSET_SECONDS * 1000 + 1).problem, /whole milliseconds/);
  const huge = Array.from({ length: 100 }, (_, index) => cue(index * 1000, index * 1000 + 900, '&'.repeat(300)));
  assert.match(captionDraftFileText(source, huge, 0).problem, /over the 64 KB limit/);
});
