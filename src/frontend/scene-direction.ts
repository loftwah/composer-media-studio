/** Preview a creator-written change against stable scene IDs; never touches media. */
export type DirectionMode = 'append' | 'replace';
type SceneDirection = { id: string; direction: string };
export type DirectionPreview = { id: string; before: string; after: string };
export function previewSceneDirections(scenes: SceneDirection[], selectedIds: string[], input: string, mode: DirectionMode): { edits: DirectionPreview[]; error: string } {
  const selected = new Set(selectedIds);
  if (!selected.size) return { edits: [], error: 'Choose at least one scene.' };
  if (selectedIds.length !== selected.size || [...selected].some(id => !scenes.some(scene => scene.id === id))) return { edits: [], error: 'The selected scenes changed. Choose them again.' };
  const instruction = input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').trim();
  if (!instruction) return { edits: [], error: 'Write the direction to apply.' };
  const edits = scenes.filter(scene => selected.has(scene.id)).map(scene => ({ id: scene.id, before: scene.direction, after: mode === 'replace' ? instruction : `${scene.direction}${scene.direction ? '\n' : ''}${instruction}` }));
  if (edits.some(edit => edit.after.length > 1200)) return { edits: [], error: 'A resulting direction exceeds 1,200 characters. Shorten the instruction or edit that scene separately.' };
  return { edits, error: '' };
}
