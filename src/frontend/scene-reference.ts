/** Preview an explicit same-project reference change without changing a plan. */
type SceneReference = { id: string; referenceAssetId: string | null };
export type ReferenceMode = 'set' | 'clear';
export function previewSceneReferences(scenes: SceneReference[], selectedIds: string[], mode: ReferenceMode, assetId: string, availableIds: string[]) {
  const selected = new Set(selectedIds);
  if (!selected.size) return { edits: [], error: 'Choose at least one scene.' };
  if (selected.size !== selectedIds.length || [...selected].some(id => !scenes.some(scene => scene.id === id))) return { edits: [], error: 'The selected scenes changed. Choose them again.' };
  if (mode !== 'set' && mode !== 'clear') return { edits: [], error: 'Choose how to change references.' };
  if (mode === 'set' && (!assetId || !availableIds.includes(assetId))) return { edits: [], error: 'Choose an available still from this studio.' };
  const after = mode === 'clear' ? null : assetId;
  return { edits: scenes.filter(scene => selected.has(scene.id)).map(scene => ({ id: scene.id, before: scene.referenceAssetId, after })), error: '' };
}
