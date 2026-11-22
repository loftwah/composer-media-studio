import { maxSongCaptions, readSongCaptionFields } from '../lib/song-caption-fields.ts';

type DraftCue = Parameters<typeof readSongCaptionFields>[0];

const instructions = {
  start: 'needs a start and end accurate to a millisecond.',
  end: 'needs a start and end accurate to a millisecond.',
  segment: 'must stay inside the saved song segment.',
  order: 'must end after it starts.',
  missing_words: 'needs words.',
  words: 'needs a single line of up to 300 characters.',
  speaker: 'has a speaker label that needs to fit in a single line of up to 80 characters.',
};

export function captionDraftProblem(cues: readonly DraftCue[], startMs: number, endMs: number): string | null {
  if (cues.length > maxSongCaptions) return `Keep at most ${maxSongCaptions} captions in this plan.`;
  for (const [index, cue] of cues.entries()) {
    const { problem } = readSongCaptionFields(cue, startMs, endMs);
    if (problem) return `Caption ${index + 1} ${instructions[problem]}`;
  }
  return null;
}
