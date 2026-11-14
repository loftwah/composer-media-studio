import type { CompositionV1, MediaAssetV1 } from './contracts';
import { shotRange } from '../../public/shot-trims.js';

export type CaptionCue = { id: string; startMs: number; endMs: number; text: string; speaker: string };
export type CaptionSnapshot = { planId: string; revision: number; sourceStartMs: number; cues: CaptionCue[] };
type SavedPlan = { id: string; revision: number; songAssetId: string; songSha256: string; startMs: number; endMs: number; scenes: { id: string; selectedTakeId: string | null; startMs: number; endMs: number }[]; captions?: { source: string; rightsConfirmed: boolean; cues: CaptionCue[] } | null };

/** Compare the current saved plan to the storyboard's frozen origin. */
export function resolveCaptionSnapshot(composition: CompositionV1, assets: MediaAssetV1[], plan: SavedPlan | undefined): CaptionSnapshot {
  const origin=composition.originSongPlan;
  if (!origin || !plan || plan.id !== origin.id || plan.revision !== origin.revision || plan.songSha256 !== origin.songSha256 || plan.startMs !== origin.sourceStartMs || plan.endMs !== origin.sourceEndMs) throw new Error('The saved song plan has changed or is unavailable. Make a new storyboard from its current revision before using captions.');
  const song=assets.find(asset => asset.id === plan.songAssetId && asset.kind === 'audio');
  if (!song || song.sha256 !== plan.songSha256) throw new Error('The source song is unavailable or has changed.');
  if (!Array.isArray(plan.scenes) || !Array.isArray(origin.scenes) || plan.scenes.length !== origin.scenes.length || composition.shots.length !== origin.scenes.length) throw new Error('The storyboard no longer matches the song plan. Make a new storyboard before using captions.');
  let cursor=plan.startMs;
  for (const [i, scene] of plan.scenes.entries()) {
    const expected=origin.scenes[i], shot=composition.shots[i];
    const clip=assets.find(asset => asset.id === shot?.assetId && asset.kind === 'video');
    const range=shot && shotRange(shot, clip), frozen=expected && shotRange(expected, clip);
    if (!expected || scene.id !== expected.id || scene.selectedTakeId !== expected.selectedTakeId || scene.startMs !== expected.startMs || scene.endMs !== expected.endMs || scene.startMs !== cursor || scene.endMs <= cursor || shot?.assetId !== scene.selectedTakeId || !range || !frozen || range.start !== frozen.start || range.end !== frozen.end || range.durationMs !== scene.endMs-scene.startMs) throw new Error(`Scene ${i+1} no longer matches its saved take or timing. Make a new storyboard before using captions.`);
    cursor=scene.endMs;
  }
  if (cursor !== plan.endMs || composition.totalMs !== plan.endMs-plan.startMs) throw new Error('The storyboard duration no longer matches the song segment.');
  const saved=plan.captions;
  if (!saved || saved.source !== 'owner_supplied' || saved.rightsConfirmed !== true || !Array.isArray(saved.cues) || !saved.cues.length || saved.cues.length > 100) throw new Error('Save owner-supplied captions with permission in the song plan first.');
  const cues=[...saved.cues].sort((a,b)=>a.startMs-b.startMs || a.endMs-b.endMs);
  let last=plan.startMs;
  for (const cue of cues) {
    if (!cue || typeof cue.id !== 'string' || !Number.isSafeInteger(cue.startMs) || !Number.isSafeInteger(cue.endMs) || cue.startMs < plan.startMs || cue.endMs > plan.endMs || cue.endMs <= cue.startMs || cue.startMs < last || typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 300 || typeof cue.speaker !== 'string' || cue.speaker.length > 80) throw new Error('Captions must have valid, non-overlapping times within the saved song segment.');
    last=cue.endMs;
  }
  return { planId: plan.id, revision: plan.revision, sourceStartMs: plan.startMs, cues: structuredClone(cues) };
}

/** Use whole words, failing visibly if a cue cannot fit rather than clipping it. */
export function captionLines(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const words=text.trim().split(/\s+/u); const lines: string[]=[]; let line='';
  for (const word of words) {
    if (measure(word)>maxWidth) throw new Error('A caption word is too wide for this frame. Shorten it in the song plan.');
    const next=line ? `${line} ${word}` : word;
    if (measure(next)>maxWidth) { lines.push(line); line=word; } else line=next;
  }
  if (line) lines.push(line);
  if (!lines.length || lines.length>3) throw new Error('A caption needs more than three lines. Shorten it in the song plan.');
  return lines;
}
