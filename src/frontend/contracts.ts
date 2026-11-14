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
}
export interface ViewerProps {
  projectId: string;
  asset: MediaAssetV1 | null;
  still: MediaAssetV1 | null;
  launchKitUrl: string | null;
}
