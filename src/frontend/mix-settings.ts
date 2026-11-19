import { musicPlacement } from "./music-fades.ts";

/** The numeric controls captured when a completed MP4 was exported. */
export type MixSettings = Readonly<{
  delay: number;          // video-time opener, seconds
  offset: number;         // skip into the added audio, seconds
  gain: number;           // added audio volume, percent
  originalGain: number;   // original soundtrack volume, percent
  fadeIn: number;         // seconds
  fadeOut: number;        // seconds
  quality: "standard" | "hd";
}>;

export type MixSettingsProof = Readonly<{
  videoBytes: number;
  videoSha256: string;
  audioBytes: number;
  audioSha256: string;
  videoSeconds: number;
  audioSeconds: number;
}>;

export const MAX_MIX_SETTINGS_BYTES = 16 * 1024;

const SCHEMA = "media-studio/add-music-mix-settings";
const VERSION = 1;
const SHA256 = /^[0-9a-f]{64}$/;
const qualities = ["standard", "hd"] as const;

const fail: (message: string) => never = message => { throw new Error(message); };
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value);
const finite = (value: unknown, name: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`The receipt's ${name} is not a finite number.`);
  return value;
};
const bounded = (value: unknown, min: number, max: number, name: string): number => {
  const amount = finite(value, name);
  if (amount < min || amount > max) fail(`The receipt's ${name} is outside these files.`);
  return amount;
};

export function mixSettingsJson(sources: Readonly<{
  videoBytes: number; videoSha256: string; audioBytes: number; audioSha256: string;
}>, mix: MixSettings): string {
  return JSON.stringify({
    schema: SCHEMA,
    version: VERSION,
    video: { bytes: sources.videoBytes, sha256: sources.videoSha256 },
    audio: { bytes: sources.audioBytes, sha256: sources.audioSha256 },
    mix,
  }, null, 2) + "\n";
}

/**
 * Validate a v1 mix settings receipt against the exact sources already chosen,
 * then return only the editable controls. This is local data: no upload, export
 * or persistence, and filenames are never used to identify the sources.
 */
export function parseMixSettings(text: string, proof: MixSettingsProof): MixSettings {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_MIX_SETTINGS_BYTES)
    fail(`Choose a mix settings JSON file under ${MAX_MIX_SETTINGS_BYTES / 1024} KB.`);
  if (![proof.videoSeconds, proof.audioSeconds].every(Number.isFinite) || proof.videoSeconds <= 0 || proof.audioSeconds <= 0)
    fail("These files have no usable duration to restore against.");

  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail("That is not valid JSON."); }
  if (!record(value) || value.schema !== SCHEMA || value.version !== VERSION) fail("That is not mix settings v1.");

  const envelope = value;
  const source = (field: "video" | "audio", bytes: number, sha256: string) => {
    const found = envelope[field];
    if (!record(found) || typeof found.bytes !== "number" || !Number.isSafeInteger(found.bytes) || found.bytes <= 0)
      fail(`The receipt has no valid ${field} description.`);
    if (found.bytes !== bytes || typeof found.sha256 !== "string" || !SHA256.test(found.sha256) || found.sha256 !== sha256)
      fail(`This receipt is for different ${field} bytes. Your current files are unchanged.`);
  };
  source("video", proof.videoBytes, proof.videoSha256);
  source("audio", proof.audioBytes, proof.audioSha256);

  const mix = value.mix;
  if (!record(mix)) fail("The receipt has no editable mix settings.");
  const delay = bounded(mix.delay, 0, proof.videoSeconds, "delay");
  const offset = bounded(mix.offset, 0, proof.audioSeconds, "audio start");
  const gain = bounded(mix.gain, 0, 100, "added audio volume");
  const originalGain = bounded(mix.originalGain, 0, 100, "original sound volume");
  const fadeIn = bounded(mix.fadeIn, 0, proof.videoSeconds, "fade in");
  const fadeOut = bounded(mix.fadeOut, 0, proof.videoSeconds, "fade out");
  if (!oneOf(mix.quality, qualities)) fail("The receipt uses an unsupported quality.");
  // Fades must fit the audible overlap after the video-time opener is taken
  // out; musicPlacement is the same constraint the MP4 export uses.
  try { musicPlacement(proof.videoSeconds, proof.audioSeconds, offset, fadeIn, fadeOut, delay); }
  catch { fail("The saved mix does not fit these files."); }

  return { delay, offset, gain, originalGain, fadeIn, fadeOut, quality: mix.quality };
}
