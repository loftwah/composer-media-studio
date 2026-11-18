// Read-only WebM measurements from bytes already held in memory. Uses only the
// container metadata: no packet scan, decode, storage read or network access.
// Anything absent, unsupported or invalid stays null, so an upload it cannot
// read keeps the unmeasured state described in #330.
import { BufferSource, Input, WEBM } from 'mediabunny';
import type { VideoMetadata } from './media-metadata.ts';

// A positive duration in whole milliseconds, or null when the value cannot be trusted.
const wholeMilliseconds = (seconds: number | null): number | null => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const rounded = Math.round(seconds * 1000);
  return Number.isSafeInteger(rounded) && rounded > 0 ? rounded : null;
};

// A positive whole-pixel display dimension, or null when the value cannot be trusted.
const wholePixels = (value: number | null): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return null;
  const rounded = Math.round(value);
  return Number.isSafeInteger(rounded) && rounded >= 16 ? rounded : null;
};

// One unreadable field must not discard the others.
const settle = (field: Promise<number | null>): Promise<number | null> =>
  field.then((value) => value, () => null);

export async function webmVideoSize(bytes: Uint8Array<ArrayBuffer>): Promise<VideoMetadata> {
  const input = new Input({ formats: [WEBM], source: new BufferSource(bytes) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return { durationMs: null, width: null, height: null };
    const [seconds, width, height] = await Promise.all([
      settle(track.getDurationFromMetadata({ skipLiveWait: true })),
      settle(track.getDisplayWidth()),
      settle(track.getDisplayHeight()),
    ]);
    return { durationMs: wholeMilliseconds(seconds), width: wholePixels(width), height: wholePixels(height) };
  } catch {
    return { durationMs: null, width: null, height: null };
  } finally {
    input.dispose();
  }
}
