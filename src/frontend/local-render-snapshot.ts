import type { CompositionV1, MediaAssetV1 } from './contracts';

export type SavedProject = {
  compositions?: CompositionV1[];
  assets?: MediaAssetV1[];
};

const identity = (composition: CompositionV1) =>
  JSON.stringify({
    id: composition.id,
    title: composition.title,
    updatedAt: composition.updatedAt,
    shots: composition.shots,
    totalMs: composition.totalMs,
    audioAssetId: composition.audioAssetId,
    audioTracks: composition.audioTracks,
    slateAssetId: composition.slateAssetId,
    originSongPlan: composition.originSongPlan,
  });

/**
 * A local render must use the storyboard the server has saved, not a card
 * object captured before a take or soundtrack changed. The clicked id is the
 * identity key: an earlier storyboard revision still renders its own exact cut.
 */
export function resolveLocalRenderSnapshot(
  clicked: CompositionV1,
  project: SavedProject,
): { composition: CompositionV1; assets: MediaAssetV1[]; changed: boolean } {
  if (!Array.isArray(project.compositions) || !Array.isArray(project.assets))
    throw new Error('Could not check the saved storyboard. Reload the project and try again.');
  const current = project.compositions.find((item) => item.id === clicked.id);
  if (!current)
    throw new Error('This saved storyboard is no longer in the studio. Reload the project and try again.');
  return {
    composition: structuredClone(current),
    assets: structuredClone(project.assets),
    changed: identity(current) !== identity(clicked),
  };
}

export function savedRevisionLabel(composition: CompositionV1): string {
  if (composition.originSongPlan)
    return `plan revision ${composition.originSongPlan.revision}`;
  return `saved version ${new Date(composition.updatedAt ?? composition.createdAt).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

/** Name the downloaded bytes using the exact saved storyboard and output dimensions. */
export function localRenderDownloadName(composition: CompositionV1, frame: { width: number; height: number }): string {
  const slug = composition.title.normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  // Fifty code points leave room for the revision and dimensions even in UTF-8.
  const stem = Array.from(slug).slice(0, 50).join('').replace(/-+$/g, '') || 'studio-local-render';
  const savedAt = composition.updatedAt ?? composition.createdAt;
  const revision = /^\d+$/.test(String(savedAt)) ? Number(savedAt) : Date.parse(String(savedAt));
  const version = Number.isSafeInteger(revision) ? revision : 'saved';
  return `${stem}-${version}-${frame.width}x${frame.height}.mp4`;
}
