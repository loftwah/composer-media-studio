export interface PortableSongPlan { format: 'media-studio-song-plan'; version: 1; songSha256: string; plan: { title: string; treatment: string; aspect: '16:9' | '9:16' | '1:1'; startMs: number; endMs: number; scenes: { startMs: number; endMs: number; direction: string }[]; captions: { startMs: number; endMs: number; text: string; speaker: string }[] } }
export function readSongPlanPack(value: unknown): PortableSongPlan;
export function createSongPlanPack(plan: unknown): PortableSongPlan;
