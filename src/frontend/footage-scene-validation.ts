import type { MediaAssetV1 } from './contracts';
export type ExportScene = { id: string; sourceStartMs: number; sourceEndMs: number };
export type ExportPlan = { id: string; revision: number; sourceAssetId: string; sourceSha256: string; rightsConfirmed: boolean; scenes: ExportScene[] };
export function validateExportSnapshot(plan: ExportPlan, scene: ExportScene, current: ExportPlan | undefined, assets: MediaAssetV1[]): MediaAssetV1 {
  const savedScene = current?.scenes?.find(item => item.id === scene.id);
  if (!current || current.id !== plan.id || current.revision !== plan.revision || current.rightsConfirmed !== true || current.sourceAssetId !== plan.sourceAssetId || current.sourceSha256 !== plan.sourceSha256 || !savedScene || savedScene.sourceStartMs !== scene.sourceStartMs || savedScene.sourceEndMs !== scene.sourceEndMs) throw new Error('The saved cut map changed. Reload it before exporting.');
  const asset = assets.find(item => item.id === current.sourceAssetId && item.kind === 'video');
  if (!asset || asset.sha256 !== current.sourceSha256 || !asset.durationMs || asset.durationMs > 180000 || !Number.isSafeInteger(scene.sourceStartMs) || !Number.isSafeInteger(scene.sourceEndMs) || scene.sourceStartMs < 0 || scene.sourceEndMs > asset.durationMs || scene.sourceEndMs <= scene.sourceStartMs || scene.sourceEndMs - scene.sourceStartMs > 60000) throw new Error('The source or saved scene is unavailable or exceeds local export limits.');
  return asset;
}
