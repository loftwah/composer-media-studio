// MIT. An explicit, in-memory draft handoff; this module makes no requests.
//
// Authored here; public/voice-handoff.js is emitted by scripts/launcher-assets.mjs.

/** The narration fields this handoff overrides while preserving every other draft field. */
export interface VoiceDraft {
  kind: string;
  model: string;
  recipeSlug: string;
  prompt: string;
  referenceAssetId: string | null;
  maskAssetId: string | null;
  parentAssetId: string | null;
  controls: Record<string, unknown>;
}

export interface StudioVoiceModel {
  id: string;
  kind: string;
  audio?: { mode: string; maxChars?: number } | null;
}

export function prepareVoiceDraft<T extends object>(
  current: T | null | undefined,
  script: string,
  model: StudioVoiceModel | null | undefined,
): { previous: T; voice: T & VoiceDraft } {
  if (!current || typeof current !== 'object') throw new Error('Open a studio before preparing narration.');
  if (typeof script !== 'string' || !script.trim()) throw new Error('Add spoken words first.');
  if (model?.id !== 'studio-voice' || model.kind !== 'audio' || model.audio?.mode !== 'speech') throw new Error('Studio Voice is unavailable in this studio.');
  const limit = Math.min(Number(model.audio.maxChars) || 1200, 1200);
  if (script.length > limit) throw new Error(`Studio Voice accepts up to ${limit} characters. Shorten the script or copy it in parts.`);
  return { previous: structuredClone(current), voice: { ...structuredClone(current), kind:'audio', model:'studio-voice', recipeSlug:'', prompt:script, referenceAssetId:null, maskAssetId:null, parentAssetId:null, controls:{} } };
}
export function restoreCreateDraft<T extends object>(drafts: readonly T[], index: number, current: T, preserveCurrent = true): { restored: T; remaining: T[] } {
  if (!Number.isInteger(index) || index < 0 || index >= drafts.length) throw new Error('Choose a saved session draft.');
  const remaining = drafts.map(draft=>structuredClone(draft));
  const [restored] = remaining.splice(index,1);
  if (preserveCurrent) remaining.push(structuredClone(current));
  return { restored, remaining };
}
// Missing baselines fail safe: treat an existing draft as edited.
export function hasCreateDraftChanges(current: unknown, baseline: unknown): boolean {
  if (!current) return false;
  return !baseline || JSON.stringify(current) !== JSON.stringify(baseline);
}
// Keep only edited drafts and preserve their original project identity.
export function switchCreateProject<T extends object>(cache: Map<string, T>, baselines: Map<string, T>, currentProjectId: string | null | undefined, current: T | null | undefined, nextProjectId: string, makeDefault: () => T): T {
  if (currentProjectId === nextProjectId && current) return current;
  if (currentProjectId && current) {
    if (hasCreateDraftChanges(current, baselines.get(currentProjectId))) cache.set(currentProjectId, structuredClone(current));
    else cache.delete(currentProjectId);
  }
  if (!baselines.has(nextProjectId)) baselines.set(nextProjectId, structuredClone(makeDefault()));
  const next = cache.has(nextProjectId) ? structuredClone(cache.get(nextProjectId)!) : structuredClone(baselines.get(nextProjectId)!);
  cache.delete(nextProjectId);
  return next;
}
// Detached controls can emit a late change while another project is opening.
export function createEventBelongsToProject(owner: string | null | undefined, activeProjectId: string, draftProjectId: string): boolean {
  return !owner || (owner === activeProjectId && owner === draftProjectId);
}
export function shouldWarnCreateDrafts<T extends object>(cache: Map<string, T>, previous: Map<string, readonly T[]>, current: T | null | undefined, baseline: T | undefined): boolean {
  return cache.size > 0 || hasCreateDraftChanges(current, baseline) || [...previous.values()].some(drafts => drafts.length > 0);
}
