// Versioned portable plan. Authored text remains private and is not scrubbed.
import type { CaptionCue, SongAspect, SongPlanScene, SongPlanSpec } from './song-plans.ts';

type PortableScene = Pick<SongPlanScene, 'startMs' | 'endMs' | 'direction'>;
type PortableCaption = Pick<CaptionCue, 'startMs' | 'endMs' | 'text' | 'speaker'>;

/** Timing and authored text only. Media and project-specific links stay in Studio. */
export interface PortableSongPlan {
  format: 'media-studio-song-plan';
  version: 1;
  songSha256: string;
  plan: {
    title: string;
    treatment: string;
    aspect: SongAspect;
    startMs: number;
    endMs: number;
    scenes: PortableScene[];
    captions: PortableCaption[];
  };
}

export type SongPlanPackSource = Pick<SongPlanSpec, 'title' | 'treatment' | 'startMs' | 'endMs'> & {
  songSha256: string;
  aspect: string;
  scenes: readonly PortableScene[];
  captions?: { cues: readonly PortableCaption[] } | null;
};

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const list = (value: unknown): value is readonly unknown[] => Array.isArray(value);
const canonical = (value: string): boolean =>
  value === value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').trim();
const inlineText = (value: string): boolean =>
  value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);

function isPortableSongPlan(value: unknown): value is PortableSongPlan {
  if (!exact(value, ['format', 'version', 'songSha256', 'plan'])
    || value.format !== 'media-studio-song-plan' || value.version !== 1
    || typeof value.songSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.songSha256)) return false;

  const plan = value.plan;
  if (!exact(plan, ['title', 'treatment', 'aspect', 'startMs', 'endMs', 'scenes', 'captions'])
    || typeof plan.title !== 'string' || !plan.title.trim() || !canonical(plan.title) || plan.title.length > 80
    || typeof plan.treatment !== 'string' || !canonical(plan.treatment) || plan.treatment.length > 1200
    || (plan.aspect !== '16:9' && plan.aspect !== '9:16' && plan.aspect !== '1:1')
    || !integer(plan.startMs) || !integer(plan.endMs)
    || plan.endMs - plan.startMs < 2000 || plan.endMs - plan.startMs > 60000
    || !list(plan.scenes) || plan.scenes.length < 2 || plan.scenes.length > 6
    || !list(plan.captions) || plan.captions.length > 100) return false;

  let cursor = plan.startMs;
  for (const scene of plan.scenes) {
    if (!exact(scene, ['startMs', 'endMs', 'direction'])
      || !integer(scene.startMs) || !integer(scene.endMs)
      || scene.startMs !== cursor || scene.endMs <= scene.startMs || scene.endMs > plan.endMs
      || typeof scene.direction !== 'string' || !canonical(scene.direction) || scene.direction.length > 1200) return false;
    cursor = scene.endMs;
  }
  if (cursor !== plan.endMs) return false;

  let priorStart = -1;
  let priorEnd = -1;
  for (const caption of plan.captions) {
    if (!exact(caption, ['startMs', 'endMs', 'text', 'speaker'])
      || !integer(caption.startMs) || !integer(caption.endMs)
      || caption.startMs < plan.startMs || caption.endMs > plan.endMs || caption.endMs <= caption.startMs
      || typeof caption.text !== 'string' || !caption.text || caption.text.length > 300 || !inlineText(caption.text)
      || typeof caption.speaker !== 'string' || caption.speaker.length > 80 || !inlineText(caption.speaker)
      || caption.startMs < priorStart || (caption.startMs === priorStart && caption.endMs < priorEnd)) return false;
    priorStart = caption.startMs;
    priorEnd = caption.endMs;
  }
  return true;
}

export function readSongPlanPack(value: unknown): PortableSongPlan {
  if (!isPortableSongPlan(value)) throw new Error('This is not a supported portable song plan.');
  return value;
}

export function createSongPlanPack(source: SongPlanPackSource): PortableSongPlan {
  return readSongPlanPack({
    format: 'media-studio-song-plan',
    version: 1,
    songSha256: source.songSha256,
    plan: {
      title: source.title,
      treatment: source.treatment,
      aspect: source.aspect,
      startMs: source.startMs,
      endMs: source.endMs,
      scenes: source.scenes.map(({ startMs, endMs, direction }) => ({ startMs, endMs, direction })),
      captions: (source.captions?.cues ?? []).map(({ startMs, endMs, text, speaker }) =>
        ({ startMs, endMs, text, speaker: speaker ?? '' })),
    },
  });
}
