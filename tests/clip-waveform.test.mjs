import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SILENT_PEAK,
  addClipWaveformFrames,
  clipWaveformWindow,
  createClipWaveformAccumulator,
  finishClipWaveform,
} from "../src/frontend/clip-waveform-peaks.ts";

function stereoFrames(values) {
  // values is structured [[left, right], ...]
  return Float32Array.from(values.flat());
}

function close(actual, expected, message = "") {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}${actual} ≈ ${expected}`);
}

function closePeaks(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => close(value, expected[index], `bucket ${index}: `));
}

test("peaks stay on absolute source seconds when the trim starts later", () => {
  const accumulator = createClipWaveformAccumulator(3, 13, 10);
  assert.ok(accumulator);
  // A 10 Hz stereo sample beginning before the window: only frames at or after
  // 3.000 are inside; the stereo peak is the louder channel's absolute value.
  addClipWaveformFrames(accumulator, 2.5, 10, 2, stereoFrames([
    [0.9, 0.9],
    [0.9, 0.9],
    [0.9, 0.9],
    [0.9, 0.9],
    [0.9, 0.9],
    [0.5, -0.7], // 3.0
    [0.1, 0.2], // 3.1
  ]));
  addClipWaveformFrames(accumulator, 5.0, 10, 2, stereoFrames([
    [0.2, 0.3], // 5.0
    [0.6, 0.1], // 5.1
  ]));
  const waveform = finishClipWaveform(accumulator);
  assert.equal(waveform.startSeconds, 3);
  assert.equal(waveform.endSeconds, 13);
  assert.equal(waveform.buckets.length, 10);
  assert.equal(waveform.buckets[0].startSeconds, 3);
  assert.equal(waveform.buckets[0].endSeconds, 4);
  close(waveform.buckets[0].peak, 0.7);
  close(waveform.buckets[2].peak, 0.6);
  assert.equal(waveform.buckets[9].endSeconds, 13);
  assert.equal(waveform.buckets[9].peak, 0);
  close(waveform.peak, 0.7);
  assert.equal(accumulator.totalFrames, 4);
});

test("frame times are bucketed by the window edge, not rebased to zero", () => {
  const accumulator = createClipWaveformAccumulator(0.25, 4.25, 4);
  assert.ok(accumulator);
  addClipWaveformFrames(accumulator, 0.25, 4, 1, Float32Array.from([
    0.1, // 0.250 -> bucket 0
    0.2, // 0.500 -> bucket 0
    0.3, // 0.750 -> bucket 0
    0.4, // 1.000 -> bucket 0
    0.5, // 1.250 -> bucket 1
    0.6, // 1.500 -> bucket 1
    0.7, // 1.750 -> bucket 1
    0.5, // 2.000 -> bucket 1
    0.8, // 2.250 -> bucket 2
  ]));
  const waveform = finishClipWaveform(accumulator);
  closePeaks(waveform.buckets.map(bucket => bucket.peak), [0.4, 0.7, 0.8, 0]);
  assert.deepEqual(waveform.buckets.map(bucket => bucket.startSeconds), [0.25, 1.25, 2.25, 3.25]);
});

test("frames at or past the window end are excluded", () => {
  const accumulator = createClipWaveformAccumulator(0, 1, 2);
  assert.ok(accumulator);
  addClipWaveformFrames(accumulator, 0.4, 10, 1, Float32Array.from([0.2, 0.4, 0.9, 0.9, 0.9, 0.9, 0.9]));
  const waveform = finishClipWaveform(accumulator);
  closePeaks(waveform.buckets.map(bucket => bucket.peak), [0.2, 0.9]);
  assert.equal(accumulator.totalFrames, 6);
});

test("silence is separated from real peaks for the visual key", () => {
  const accumulator = createClipWaveformAccumulator(0, 2, 4);
  assert.ok(accumulator);
  // Two loud 0.5 s buckets, then two buckets of near-silence.
  const values = [];
  for (let frame = 0; frame < 16; frame++) {
    const loud = frame < 8;
    values.push(loud ? 0.8 : SILENT_PEAK / 2);
  }
  addClipWaveformFrames(accumulator, 0, 8, 1, Float32Array.from(values));
  const waveform = finishClipWaveform(accumulator);
  close(waveform.peak, 0.8);
  assert.equal(waveform.silentBuckets, 2);
  assert.deepEqual(waveform.buckets.map(bucket => bucket.peak >= SILENT_PEAK), [true, true, false, false]);
});

test("a window with only silence reports zero peak and every silent bucket", () => {
  const accumulator = createClipWaveformAccumulator(10, 11, 5);
  assert.ok(accumulator);
  addClipWaveformFrames(accumulator, 10, 5, 2, new Float32Array(10));
  const waveform = finishClipWaveform(accumulator);
  assert.equal(waveform.peak, 0);
  assert.equal(waveform.silentBuckets, 5);
  assert.equal(accumulator.totalFrames, 5);
});

test("windows are bounded to a valid, at-most-60-second clip range", () => {
  assert.deepEqual(clipWaveformWindow(2, 8), { startSeconds: 2, endSeconds: 8 });
  assert.deepEqual(clipWaveformWindow(0, 60), { startSeconds: 0, endSeconds: 60 });
  for (const [start, end] of [[0, 0], [5, 4], [-1, 4], [Number.NaN, 4], [0, 60.001], [0, Number.POSITIVE_INFINITY]]) {
    assert.equal(clipWaveformWindow(start, end), null, `${start}-${end}`);
    assert.equal(createClipWaveformAccumulator(start, end), null, `${start}-${end}`);
  }
  assert.ok(createClipWaveformAccumulator(0, 1, 1));
  assert.equal(createClipWaveformAccumulator(0, 1, 0), null);
  assert.equal(createClipWaveformAccumulator(0, 1, 1.5), null);
  assert.equal(createClipWaveformAccumulator(0, 1, 601), null);
});

test("malformed sample metadata is ignored instead of corrupting a bucket", () => {
  const accumulator = createClipWaveformAccumulator(0, 1, 2);
  assert.ok(accumulator);
  addClipWaveformFrames(accumulator, Number.NaN, 10, 1, Float32Array.from([0.9]));
  addClipWaveformFrames(accumulator, 0, 0, 1, Float32Array.from([0.9]));
  addClipWaveformFrames(accumulator, 0, 10, 0, Float32Array.from([0.9]));
  addClipWaveformFrames(accumulator, 0, 10, 2, Float32Array.from([0.9]));
  assert.equal(accumulator.totalFrames, 0);
  assert.equal(finishClipWaveform(accumulator).peak, 0);
});
