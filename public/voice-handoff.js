// An explicit, in-memory draft handoff; this module makes no requests.
export function prepareVoiceDraft(current, script, model) {
  if (!current || typeof current !== 'object') throw new Error('Open a studio before preparing narration.');
  if (typeof script !== 'string' || !script.trim()) throw new Error('Add spoken words first.');
  if (model?.id !== 'studio-voice' || model.kind !== 'audio' || model.audio?.mode !== 'speech') throw new Error('Studio Voice is unavailable in this studio.');
  const limit = Math.min(Number(model.audio.maxChars) || 1200, 1200);
  if (script.length > limit) throw new Error(`Studio Voice accepts up to ${limit} characters. Shorten the script or copy it in parts.`);
  return { previous: structuredClone(current), voice: { ...structuredClone(current), kind:'audio', model:'studio-voice', recipeSlug:'', prompt:script, referenceAssetId:null, maskAssetId:null, parentAssetId:null, controls:{} } };
}
export function restoreCreateDraft(drafts, index, current) {
  if (!Number.isInteger(index) || index < 0 || index >= drafts.length) throw new Error('Choose a saved session draft.');
  const remaining = drafts.map(draft=>structuredClone(draft));
  const [restored] = remaining.splice(index,1);
  remaining.push(structuredClone(current));
  return { restored, remaining };
}
// Drafts are bound to projects before a new project becomes visible.
export function switchCreateProject(cache, currentProjectId, current, nextProjectId, makeDefault) {
  if (currentProjectId === nextProjectId && current) return current;
  if (currentProjectId && current) cache.set(currentProjectId, structuredClone(current));
  return cache.has(nextProjectId) ? structuredClone(cache.get(nextProjectId)) : makeDefault();
}
// Detached controls can emit a late change while another project is opening.
export function createEventBelongsToProject(owner, activeProjectId, draftProjectId) {
  return !owner || (owner === activeProjectId && owner === draftProjectId);
}
