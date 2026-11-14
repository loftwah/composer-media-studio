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
