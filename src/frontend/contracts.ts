/** Read-only shape returned by the existing /api/state project summary. */
export interface ProjectSummaryV1 {
  id: string;
  name: string;
  creativeDirection: string;
  cover: string | null;
  counts: { image: number; video: number; audio: number };
  budget: { spentMicro: number; allowanceMicro: number };
}

export interface HomeProps {
  projects: ProjectSummaryV1[];
  videosConfigured: boolean;
  woodhouseShare: boolean;
}

/** Read-only media contract returned by GET /api/projects/:id. */
export interface MediaAssetV1 {
  id: string;
  kind: "image" | "video" | "audio";
  title: string;
  caption: string | null;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sampleRate: number | null;
  channels: number | null;
  sha256: string;
  source: string;
  createdAt: string | number;
  file: string;
  download: string;
  reuseStillId?: string | null;
}
export interface LibraryProps {
  projectId: string;
  assets: MediaAssetV1[];
  query: string;
  filter: "all" | "image" | "video" | "audio";
  canImportShare: boolean;
  comparing: boolean;
  compareIds: string[];
}
export interface ViewerProps {
  projectId: string;
  asset: MediaAssetV1 | null;
  still: MediaAssetV1 | null;
  launchKitUrl: string | null;
}

export interface RecipeControlV1 { key: string; label: string; type: string; default?: string | number; application?: string; options?: string[] }
export interface RecipeV1 { slug: string; title: string; description: string; kind: string; controls: RecipeControlV1[] }
export interface ModelV1 {
  id: string; label: string; provider: string; kind: string; description: string; costBasis: string;
  references: number; aspects: string[]; durations: number[] | null; mask: boolean;
  edit: string | null; promptRequired: boolean; audio: { mode: string; minSeconds?: number; maxSeconds?: number } | null;
}
export interface CreateStateV1 {
  kind: string; model: string; recipeSlug: string; prompt: string; aspect: string;
  durationSeconds: number; referenceAssetId: string | null; maskAssetId: string | null;
  controls: Record<string, string | number>;
  showAllReferences?: boolean;
}
export interface CreateProps {
  create: CreateStateV1; models: ModelV1[]; recipes: RecipeV1[]; images: MediaAssetV1[];
  selectedReference: MediaAssetV1 | null; maskAsset: MediaAssetV1 | null;
  model: ModelV1 | null; recipe: RecipeV1 | null; estimateMicro: number;
  fundingBlocked: boolean; permissionBlocked: boolean; executionFailed: boolean;
}

export interface GenerationV1 {
  id: string; model: string; kind: string; status: string; prompt: string;
  aspect: string | null; durationSeconds: number | null; assetId: string | null;
  createdAt: string | number; costObservedMicro: number | null; costEstimateMicro: number;
  error: { code: string; message: string } | null;
}
export interface PublicationV1 { id: string; title: string; path: string; createdAt: string | number }
export interface HistoryProps { generations: GenerationV1[]; assets: MediaAssetV1[]; models: ModelV1[] }
export interface PublishProps { publications: PublicationV1[]; origin: string }

export interface AudioTrackV1 { assetId: string; role: string; startMs: number; trimStartMs: number; trimEndMs: number; gainDb: number; fadeInMs: number; fadeOutMs: number }
export interface ComposeStateV1 { shotIds: string[]; audioAssetId: string | null; audioTracks: AudioTrackV1[]; title: string; editingId: string | null }
export interface CompositionV1 { id: string; title: string; shots: { assetId: string }[]; totalMs: number; audioAssetId: string | null; audioTracks?: AudioTrackV1[]; createdAt: string | number; updatedAt?: string | number }
export interface ComposeGenerationV1 extends GenerationV1 { compositionId?: string; variant?: string }
export interface AssembleProps { compose: ComposeStateV1; assets: MediaAssetV1[]; compositions: CompositionV1[]; generations: ComposeGenerationV1[]; assemblyCost: number; socialCost: number }
export interface SettingsProps { project: { id: string; name: string; creativeDirection: string; visibility: string; references?: { id: string; title: string; url: string }[] }; draft?: { name: string; creativeDirection: string; visibility: string; referenceTitle: string; referenceUrl: string } }
