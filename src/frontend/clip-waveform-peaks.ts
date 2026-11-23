import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, type AudioSample, type InputAudioTrack } from "mediabunny";

// The waveform is deliberately small and bounded: one analysis covers only the
// already selected clip window, at most a minute of source time. Peaks are
// accumulated per decoded sample, so no whole-file AudioBuffer is ever built.
export const CLIP_WAVEFORM_BUCKETS = 120;
export const MAX_CLIP_WAVEFORM_SECONDS = 60;
// Anything quieter than this is drawn as the flat silence line. 0.005 is about
// -46 dBFS, well below audible speech but above reserved digital silence.
export const SILENT_PEAK = 0.005;

export type ClipWaveformBucket = Readonly<{
  startSeconds: number;
  endSeconds: number;
  peak: number;
}>;

export type ClipWaveformResult = Readonly<{
  startSeconds: number;
  endSeconds: number;
  buckets: ClipWaveformBucket[];
  peak: number;
  silentBuckets: number;
}>;

export type ClipWaveformOutcome =
  | { kind: "ready"; waveform: ClipWaveformResult }
  | { kind: "invalid-window" }
  | { kind: "no-audio" }
  | { kind: "no-decoder" }
  | { kind: "no-samples" }
  | { kind: "decode-failed" };

export type ClipWaveformAccumulator = {
  startSeconds: number;
  endSeconds: number;
  bucketCount: number;
  peaks: Float32Array;
  totalFrames: number;
};

// The one window rule for both decoding and the pure peak tests. A zero-length
// window, a non-finite value or more than the clip maximum yields null instead
// of a partially labelled waveform.
export function clipWaveformWindow(
  startSeconds: number,
  endSeconds: number,
): { startSeconds: number; endSeconds: number } | null {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) return null;
  if (startSeconds < 0 || endSeconds <= startSeconds) return null;
  if (endSeconds - startSeconds > MAX_CLIP_WAVEFORM_SECONDS) return null;
  return { startSeconds, endSeconds };
}

export function createClipWaveformAccumulator(
  startSeconds: number,
  endSeconds: number,
  bucketCount = CLIP_WAVEFORM_BUCKETS,
): ClipWaveformAccumulator | null {
  const window = clipWaveformWindow(startSeconds, endSeconds);
  if (!window) return null;
  if (!Number.isInteger(bucketCount) || bucketCount < 1 || bucketCount > 600) return null;
  return {
    startSeconds: window.startSeconds,
    endSeconds: window.endSeconds,
    bucketCount,
    peaks: new Float32Array(bucketCount),
    totalFrames: 0,
  };
}

// Add one decoded sample's interleaved f32 frames. Frame times are absolute
// source seconds, so a nonzero trim start keeps every bucket on the source
// timeline instead of rebasing to zero. Frames outside the window are ignored,
// which also clips the sample that begins just before the trim start.
export function addClipWaveformFrames(
  accumulator: ClipWaveformAccumulator,
  timestampSeconds: number,
  sampleRate: number,
  numberOfChannels: number,
  frames: Float32Array,
): void {
  if (!Number.isFinite(timestampSeconds) || !Number.isFinite(sampleRate) || sampleRate <= 0) return;
  if (!Number.isInteger(numberOfChannels) || numberOfChannels < 1) return;
  if (!frames.length || frames.length % numberOfChannels !== 0) return;
  const duration = accumulator.endSeconds - accumulator.startSeconds;
  if (!(duration > 0)) return;
  const frameCount = frames.length / numberOfChannels;
  for (let frame = 0; frame < frameCount; frame++) {
    const time = timestampSeconds + frame / sampleRate;
    if (time < accumulator.startSeconds) continue;
    if (time >= accumulator.endSeconds) break;
    const bucket = Math.min(
      accumulator.bucketCount - 1,
      Math.floor(((time - accumulator.startSeconds) / duration) * accumulator.bucketCount),
    );
    const offset = frame * numberOfChannels;
    let peak = 0;
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const value = Math.abs(frames[offset + channel]);
      if (value > peak) peak = value;
    }
    if (peak > accumulator.peaks[bucket]) accumulator.peaks[bucket] = peak;
    accumulator.totalFrames++;
  }
}

export function finishClipWaveform(accumulator: ClipWaveformAccumulator): ClipWaveformResult {
  const duration = accumulator.endSeconds - accumulator.startSeconds;
  const step = duration / accumulator.bucketCount;
  let peak = 0;
  let silentBuckets = 0;
  const buckets: ClipWaveformBucket[] = [];
  for (let index = 0; index < accumulator.bucketCount; index++) {
    const value = Math.min(1, accumulator.peaks[index]);
    const startSeconds = accumulator.startSeconds + step * index;
    const endSeconds = index === accumulator.bucketCount - 1
      ? accumulator.endSeconds
      : accumulator.startSeconds + step * (index + 1);
    if (value > peak) peak = value;
    if (value < SILENT_PEAK) silentBuckets++;
    buckets.push({ startSeconds, endSeconds, peak: value });
  }
  return {
    startSeconds: accumulator.startSeconds,
    endSeconds: accumulator.endSeconds,
    buckets,
    peak,
    silentBuckets,
  };
}

function abortError(): DOMException {
  return new DOMException("Waveform analysis cancelled.", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

/**
 * Decode peaks for the selected source window only, using the installed
 * Mediabunny BlobSource/Input and AudioSampleSink. Each sample is closed as soon
 * as its peak is recorded and the Input is disposed on every path. This only
 * reads audio: it never encodes, exports, touches captions/trim or uses a
 * network service.
 */
export async function analyseClipWaveform(
  file: File,
  startSeconds: number,
  endSeconds: number,
  options: Readonly<{
    signal: AbortSignal;
    bucketCount?: number;
    onProgress?: (fraction: number) => void;
  }>,
): Promise<ClipWaveformOutcome> {
  const accumulator = createClipWaveformAccumulator(startSeconds, endSeconds, options.bucketCount);
  if (!accumulator) return { kind: "invalid-window" };
  const { signal } = options;
  throwIfAborted(signal);
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  let reportedProgress = -1;
  const report = (fraction: number) => {
    const bounded = Math.min(1, Math.max(0, fraction));
    if (bounded <= reportedProgress) return;
    reportedProgress = bounded;
    options.onProgress?.(bounded);
  };
  try {
    let track: InputAudioTrack | null;
    try {
      track = await input.getPrimaryAudioTrack();
    } catch {
      return { kind: "no-decoder" };
    }
    throwIfAborted(signal);
    if (!track) return { kind: "no-audio" };
    if (!await track.canDecode()) return { kind: "no-decoder" };
    const [numberOfChannels, sampleRate] = await Promise.all([
      track.getNumberOfChannels(),
      track.getSampleRate(),
    ]);
    throwIfAborted(signal);
    if (!Number.isInteger(numberOfChannels) || numberOfChannels < 1 || numberOfChannels > 8 ||
      !Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate > 192_000) {
      return { kind: "no-decoder" };
    }

    const sink = new AudioSampleSink(track);
    const addSample = (sample: AudioSample) => {
      if (sample.numberOfChannels !== numberOfChannels ||
        sample.numberOfFrames <= 0 || sample.numberOfFrames > 1_000_000) {
        throw new Error("Unexpected audio sample.");
      }
      const bytes = sample.allocationSize({ planeIndex: 0, format: "f32" });
      if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes % 4 !== 0 || bytes > 32 * 1024 * 1024) {
        throw new Error("Unexpected audio sample size.");
      }
      const frames = new Float32Array(bytes / 4);
      sample.copyTo(frames, { planeIndex: 0, format: "f32" });
      addClipWaveformFrames(accumulator, sample.timestamp, sample.sampleRate, numberOfChannels, frames);
    };
    // The sample that starts at or before the trim start can still contain
    // frames inside the window, so read it before iterating forward.
    const preceding = await sink.getSample(accumulator.startSeconds);
    let previousTimestamp: number | null = null;
    if (preceding) {
      previousTimestamp = preceding.timestamp;
      try {
        throwIfAborted(signal);
        addSample(preceding);
        report((preceding.timestamp + preceding.duration - accumulator.startSeconds) /
          (accumulator.endSeconds - accumulator.startSeconds));
      } finally {
        preceding.close();
      }
    }
    throwIfAborted(signal);

    for await (const sample of sink.samples(accumulator.startSeconds, accumulator.endSeconds)) {
      try {
        throwIfAborted(signal);
        if (previousTimestamp !== null && sample.timestamp === previousTimestamp) continue;
        previousTimestamp = sample.timestamp;
        addSample(sample);
        report((sample.timestamp + sample.duration - accumulator.startSeconds) /
          (accumulator.endSeconds - accumulator.startSeconds));
      } finally {
        sample.close();
      }
    }
    throwIfAborted(signal);
    if (!accumulator.totalFrames) return { kind: "no-samples" };
    report(1);
    return { kind: "ready", waveform: finishClipWaveform(accumulator) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (signal.aborted) throw abortError();
    return { kind: "decode-failed" };
  } finally {
    input.dispose();
  }
}
