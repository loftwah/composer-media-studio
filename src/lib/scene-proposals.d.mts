// Narrow, type-only declarations for the scene-proposal helpers consumed by
// director.ts. Runtime behaviour stays in scene-proposals.mjs; this file only
// names the symbol and shapes that lane reads so it can be checked in strict
// TS.

interface SceneProposalStatement {
  bind(...values: unknown[]): SceneProposalStatement;
  first<Row>(): Promise<Row | null>;
}
interface SceneProposalEnv {
  DB: { prepare(query: string): SceneProposalStatement };
}
interface SceneProposalProject { id: string }

export interface SceneProposalChangeInput {
  sceneId: string;
  direction?: string;
  referenceAssetId?: string | null;
}

export interface SceneProposalChange {
  sceneId: string;
  before: { direction: string; referenceAssetId: string | null };
  after: { direction: string; referenceAssetId: string | null };
  reference: { id: string; sha256: string | null } | null;
}

export interface SceneProposalPreview {
  proposal: {
    version: 1;
    projectId: string;
    planId: string;
    expectedRevision: number;
    changes: SceneProposalChange[];
  };
  reviewDigest: string;
  revision: { id: string; revision: number; updatedAt: number; digest: string };
}

export function previewSceneProposal(
  env: SceneProposalEnv,
  project: SceneProposalProject,
  planId: string,
  input: { expectedRevision: number; changes: readonly SceneProposalChangeInput[] },
): Promise<SceneProposalPreview>;
