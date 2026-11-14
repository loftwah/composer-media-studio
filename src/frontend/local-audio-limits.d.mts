export const MAX_LOCAL_AUDIO_SECONDS: number;
export const MAX_LOCAL_PCM_BYTES: number;
export const MAX_TRIM_SECONDS: number;
export const DEFAULT_TRIM_SECONDS: number;
export const MAX_TRIM_WAV_BYTES: number;
export const MAX_TRIM_PCM_BYTES: number;
export function localAudioFits(info: {seconds:number;channels:number;sourceRate:number;deviceRate:number}): boolean;
export function trimWavFits(frames:number,channels:number): boolean;
