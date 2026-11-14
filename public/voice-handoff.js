// An explicit, in-memory draft handoff; this module makes no requests.
export function prepareVoiceDraft(current, script, model) {
  if (!current || typeof current !== 'object') throw new Error('Open a studio before preparing narration.');
  if (typeof script !== 'string' || !script.trim()) throw new Error('Add spoken words first.');
  if (model?.id !== 'studio-voice' || model.kind !== 'audio' || model.audio?.mode !== 'speech') throw new Error('Studio Voice is unavailable in this studio.');
  const limit = Math.min(Number(model.audio.maxChars) || 1200, 1200);
  if (script.length > limit) throw new Error(`Studio Voice accepts up to ${limit} characters. Shorten the script or copy it in parts.`);
  return { previous: structuredClone(current), voice: { ...structuredClone(current), kind:'audio', model:'studio-voice', recipeSlug:'', prompt:script, referenceAssetId:null, maskAssetId:null, parentAssetId:null, controls:{} } };
}
export function restoreCreateDraft(drafts, index, current, preserveCurrent = true) {
  if (!Number.isInteger(index) || index < 0 || index >= drafts.length) throw new Error('Choose a saved session draft.');
  const remaining = drafts.map(draft=>structuredClone(draft));
  const [restored] = remaining.splice(index,1);
  if (preserveCurrent) remaining.push(structuredClone(current));
  return { restored, remaining };
}
// Missing baselines fail safe: treat an existing draft as edited.
export function hasCreateDraftChanges(current, baseline) {
  if (!current) return false;
  return !baseline || JSON.stringify(current) !== JSON.stringify(baseline);
}
// Keep only edited drafts and preserve their original project identity.
export function switchCreateProject(cache, baselines, currentProjectId, current, nextProjectId, makeDefault) {
  if (currentProjectId === nextProjectId && current) return current;
  if (currentProjectId && current) {
    if (hasCreateDraftChanges(current, baselines.get(currentProjectId))) cache.set(currentProjectId, structuredClone(current));
    else cache.delete(currentProjectId);
  }
  if (!baselines.has(nextProjectId)) baselines.set(nextProjectId, structuredClone(makeDefault()));
  const next = cache.has(nextProjectId) ? structuredClone(cache.get(nextProjectId)) : structuredClone(baselines.get(nextProjectId));
  cache.delete(nextProjectId);
  return next;
}
// Detached controls can emit a late change while another project is opening.
export function createEventBelongsToProject(owner, activeProjectId, draftProjectId) {
  return !owner || (owner === activeProjectId && owner === draftProjectId);
}
export function shouldWarnCreateDrafts(cache, previous, current, baseline) {
  return cache.size > 0 || hasCreateDraftChanges(current, baseline) || [...previous.values()].some(drafts => drafts.length > 0);
}
