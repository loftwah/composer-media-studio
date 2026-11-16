// Typed, project-scoped scene proposals. Preview is stateless and does not imply human approval.
import { HttpError, sha256Hex, text } from './util.mjs';
import { songPlanRevisionDigest, updateSongPlan, viewSongPlan } from './song-plans.mjs';

const invalid = message => { throw new HttpError(400, message, 'invalid_proposal'); };
const conflict = revision => {
  throw new HttpError(409, revision
    ? `The plan changed to revision ${revision}. Reload it, then preview the edit again. Nothing was applied.`
    : 'The plan or proposed references changed. Preview the edit again. Nothing was applied.', 'proposal_conflict');
};
export async function previewSceneProposal(env, project, planId, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['expectedRevision','changes'].includes(key)) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !Array.isArray(input.changes) || input.changes.length < 1 || input.changes.length > 6) invalid('Provide a saved revision and one to six scene changes.');
  const row=await env.DB.prepare('SELECT * FROM song_plans WHERE id=?1 AND project_id=?2').bind(planId,project.id).first();
  if (!row) throw new HttpError(404, 'Song plan not found', 'not_found');
  if (row.revision !== input.expectedRevision) conflict(row.revision);
  const plan=viewSongPlan(row), requested=new Map();
  for (const change of input.changes) {
    if (!change || typeof change !== 'object' || Array.isArray(change) || Object.keys(change).some(key => !['sceneId','direction','referenceAssetId'].includes(key)) || typeof change.sceneId !== 'string' || requested.has(change.sceneId) || (!Object.hasOwn(change,'direction') && !Object.hasOwn(change,'referenceAssetId'))) invalid('Each scene needs one unique direction or reference change.');
    const entry={};
    if (Object.hasOwn(change,'direction')) { if (typeof change.direction !== 'string') invalid('Scene direction must be text.'); entry.direction=text(change.direction,1200,'Scene direction',{required:false}); }
    if (Object.hasOwn(change,'referenceAssetId')) { if (change.referenceAssetId !== null && (typeof change.referenceAssetId !== 'string' || !/^[a-z0-9_]{4,80}$/.test(change.referenceAssetId))) invalid('Choose an existing image or clear the reference.'); entry.referenceAssetId=change.referenceAssetId; }
    requested.set(change.sceneId,entry);
  }
  const changes=[];
  for (const scene of plan.scenes) {
    if (!requested.has(scene.id)) continue;
    const requestedChange=requested.get(scene.id); requested.delete(scene.id);
    const before={direction:scene.direction,referenceAssetId:scene.referenceAssetId}, after={direction:requestedChange.direction ?? scene.direction,referenceAssetId:Object.hasOwn(requestedChange,'referenceAssetId') ? requestedChange.referenceAssetId : scene.referenceAssetId};
    let reference=null;
    if (after.referenceAssetId) { const image=await env.DB.prepare('SELECT id,sha256 FROM assets WHERE id=?1 AND project_id=?2 AND kind=\'image\' AND deleted_at IS NULL').bind(after.referenceAssetId,project.id).first(); if (!image) invalid('Choose an image saved in this project.'); reference={id:image.id,sha256:image.sha256}; }
    if (before.direction !== after.direction || before.referenceAssetId !== after.referenceAssetId) changes.push({sceneId:scene.id,before,after,reference});
  }
  if (requested.size) invalid('A selected scene is not in this plan.');
  if (!changes.length) invalid('The proposal does not change any scenes.');
  const proposal={version:1,projectId:project.id,planId:plan.id,expectedRevision:plan.revision,changes};
  const reviewDigest=await sha256Hex(new TextEncoder().encode(JSON.stringify(proposal)));
  // The saved revision identity, so a reviewer can confirm every surface read
  // the same bytes and not only the same revision number.
  const revisionDigest=await songPlanRevisionDigest(row);
  return {proposal,reviewDigest,revision:{id:plan.id,revision:plan.revision,updatedAt:plan.updatedAt,digest:revisionDigest}};
}
export async function applySceneProposal(env, project, planId, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key=>!['expectedRevision','changes','reviewDigest','approved','acceptSceneIds'].includes(key)) || input.approved !== true || typeof input.reviewDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.reviewDigest)) invalid('Explicitly accept the previewed proposal.');
  if (input.acceptSceneIds !== undefined && (!Array.isArray(input.acceptSceneIds) || input.acceptSceneIds.length < 1 || input.acceptSceneIds.length > 6 || new Set(input.acceptSceneIds).size !== input.acceptSceneIds.length || input.acceptSceneIds.some(item => typeof item !== 'string'))) invalid('Accept one to six reviewed scenes, once each.');
  const {proposal,reviewDigest}=await previewSceneProposal(env,project,planId,{expectedRevision:input.expectedRevision,changes:input.changes});
  // The digest always covers the whole previewed proposal. Accepting a subset
  // proves the reviewer saw every change; only the named changes are written.
  if (reviewDigest !== input.reviewDigest) conflict();
  const wanted=input.acceptSceneIds ? new Set(input.acceptSceneIds) : null;
  if (wanted && [...wanted].some(sceneId => !proposal.changes.some(change => change.sceneId === sceneId))) invalid('An accepted scene is not part of the reviewed proposal.');
  const accepted=wanted ? proposal.changes.filter(change => wanted.has(change.sceneId)) : proposal.changes;
  const acceptedSceneIds=new Set(accepted.map(change => change.sceneId));
  const declinedSceneIds=proposal.changes.filter(change => !acceptedSceneIds.has(change.sceneId)).map(change => change.sceneId);
  const row=await env.DB.prepare('SELECT * FROM song_plans WHERE id=?1 AND project_id=?2').bind(planId,project.id).first();
  if (!row || row.revision !== proposal.expectedRevision) conflict(row?.revision);
  const plan=viewSongPlan(row), byScene=new Map(accepted.map(change=>[change.sceneId,change.after]));
  const scenes=plan.scenes.map(scene=>byScene.has(scene.id)?{...scene,...byScene.get(scene.id)}:scene);
  const references=accepted.map(change=>change.reference).filter(Boolean);
  const saved=await updateSongPlan(env,project,planId,{...plan,expectedRevision:proposal.expectedRevision,scenes},{reviewedReferences:references});
  return {plan:saved,appliedDigest:reviewDigest,acceptedSceneIds:[...acceptedSceneIds],declinedSceneIds};
}
