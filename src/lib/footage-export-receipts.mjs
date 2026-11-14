import { HttpError, id, now, safeJson } from './util.mjs';

const conflict = () => { throw new HttpError(409, 'The saved cut map or source changed. Reload before saving.', 'revision_conflict'); };
export async function createFootageExportReceipt(env, project, planId, input) {
  const keys = ['expectedRevision','sceneId','frame','fit','quality'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key)) || !Number.isSafeInteger(input.expectedRevision) || typeof input.sceneId !== 'string' || !['16:9','9:16','1:1'].includes(input.frame) || !['contain','cover'].includes(input.fit) || !['standard','hd'].includes(input.quality)) throw new HttpError(400, 'Choose a saved scene and supported export settings', 'invalid_receipt');
  const plan = await env.DB.prepare('SELECT * FROM footage_plans WHERE id=?1 AND project_id=?2').bind(planId,project.id).first();
  if (!plan) throw new HttpError(404, 'Cut map not found', 'not_found');
  if (plan.revision !== input.expectedRevision) conflict();
  const spec = safeJson(plan.spec_json, {}), scene = spec.scenes?.find(item => item.id === input.sceneId);
  const source = await env.DB.prepare('SELECT * FROM assets WHERE id=?1 AND project_id=?2 AND deleted_at IS NULL').bind(plan.source_asset_id,project.id).first();
  if (!source || source.kind !== 'video' || source.sha256 !== plan.source_sha256 || !/^[a-f0-9]{64}$/i.test(source.sha256 ?? '') || spec.rightsConfirmed !== true || !scene || !Number.isSafeInteger(scene.sourceStartMs) || !Number.isSafeInteger(scene.sourceEndMs) || scene.sourceStartMs < 0 || scene.sourceEndMs > source.duration_ms || scene.sourceEndMs <= scene.sourceStartMs) conflict();
  const duration = scene.sourceEndMs-scene.sourceStartMs;
  if (duration > 60000 || (input.quality === 'hd' && (duration < 3000 || duration > 10000))) throw new HttpError(400, 'HD exports support scenes from 3 to 10 seconds.', 'invalid_duration');
  const dimensions = input.quality === 'hd' ? {'16:9':[1280,720], '9:16':[720,1280], '1:1':[720,720]} : {'16:9':[640,360], '9:16':[360,640], '1:1':[480,480]};
  const [width,height] = dimensions[input.frame];
  const snapshot = {version:1,evidence:{snapshot:'server_verified',render:'browser_reported'},plan:{id:plan.id,revision:plan.revision},source:{assetId:source.id,sha256:source.sha256,startMs:scene.sourceStartMs,endMs:scene.sourceEndMs},framing:{aspect:input.frame,fit:input.fit,quality:input.quality,width,height},totalMs:duration};
  const receiptId=id('fer'), outputId=id('asset'), timestamp=now();
  await env.DB.prepare('DELETE FROM footage_export_receipts WHERE project_id=?1 AND expires_at<?2 AND NOT EXISTS (SELECT 1 FROM assets WHERE id=output_asset_id)').bind(project.id,timestamp).run();
  const result=await env.DB.prepare(`INSERT INTO footage_export_receipts(id,project_id,output_asset_id,plan_id,plan_revision,source_asset_id,source_sha256,snapshot_json,created_at,expires_at)
    SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10 WHERE EXISTS (SELECT 1 FROM footage_plans WHERE id=?4 AND project_id=?2 AND revision=?5 AND spec_json=?11) AND EXISTS (SELECT 1 FROM assets WHERE id=?6 AND project_id=?2 AND sha256=?7 AND deleted_at IS NULL) AND (SELECT COUNT(*) FROM footage_export_receipts r WHERE r.project_id=?2 AND r.expires_at>=?9 AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=r.output_asset_id))<16 RETURNING id`).bind(receiptId,project.id,outputId,plan.id,plan.revision,source.id,source.sha256,JSON.stringify(snapshot),timestamp,timestamp+1800000,plan.spec_json).first();
  if (!result) conflict();
  return {id:receiptId,expiresAt:timestamp+1800000};
}
