export const MAX_LOCAL_AUDIO_SECONDS = 300;
export const MAX_LOCAL_PCM_BYTES = 128 * 1024 * 1024;
export const MAX_TRIM_SECONDS = 180;
export const DEFAULT_TRIM_SECONDS = 60;
export const MAX_TRIM_WAV_BYTES = 64 * 1024 * 1024;
export const MAX_TRIM_PCM_BYTES = 80 * 1024 * 1024;
export function localAudioFits({ seconds, channels, sourceRate, deviceRate }) {
  return Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_LOCAL_AUDIO_SECONDS && Number.isInteger(channels) && channels >= 1 && channels <= 2 && Number.isFinite(sourceRate) && sourceRate > 0 && sourceRate <= 96000 && Number.isFinite(deviceRate) && deviceRate > 0 && seconds * Math.max(sourceRate, deviceRate) * channels * 4 <= MAX_LOCAL_PCM_BYTES;
}
export function trimWavFits(frames, channels) {
  return Number.isSafeInteger(frames) && frames > 0 && Number.isInteger(channels) && channels >= 1 && channels <= 2 && 44 + frames * channels * 2 <= MAX_TRIM_WAV_BYTES && frames * channels * 4 <= MAX_TRIM_PCM_BYTES;
}
