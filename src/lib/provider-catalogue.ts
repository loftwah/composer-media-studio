// MIT. The static server-side model catalogue, moved verbatim out of
// providers.mjs into a strict TypeScript source. Data, order, descriptions and
// the shared aspects reference are unchanged; provider dispatch, pricing
// arithmetic, admission, credentials and interpretation stay in providers.mjs.
//
// Image: Cloudflare Workers AI, billed to this app's own Cloudflare account.
// Video: fal.ai queue REST, billed to this app's own fal key.

export const PROVIDER_CLOUDFLARE = "cloudflare-workers-ai";
export const PROVIDER_FAL = "fal";

export type ProviderId =
  | typeof PROVIDER_CLOUDFLARE
  | typeof PROVIDER_FAL;

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ModelAudio {
  mode: "music" | "speech" | "effect";
  minSeconds?: number;
  maxSeconds?: number;
  maxChars?: number;
}

/** One active catalogue entry exactly as the provider adapters consume it. */
export interface CatalogueEntry {
  id: string;
  label: string;
  provider: ProviderId;
  endpoint: string;
  kind: "image" | "video" | "audio";
  description: string;
  aspects?: string[];
  references: number;
  durations?: number[];
  audio?: ModelAudio;
  edit?: "fill" | "cutout" | "upscale";
  promptRequired?: boolean;
  mask?: boolean;
  render?: "assembly" | "social";
  restyle?: true;
  costMicro: number;
  costPerSecondMicro?: number;
  durationCostsMicro?: Record<number, number>;
  costBasis: string;
}

/** A retired entry keeps its exact attribution for saved jobs. */
export interface RetiredCatalogueEntry {
  id: string;
  label: string;
  provider: ProviderId;
  endpoint: string;
  kind: "image";
  retiredAt: string;
  replacement: string;
  reason: string;
}

export const imageDimensions: Record<string, ImageDimensions> = {
  square: { width: 1024, height: 1024 },
  portrait: { width: 1024, height: 1280 },
  landscape: { width: 1280, height: 1024 },
  wide: { width: 1280, height: 720 },
};

export const imageAspects: string[] = Object.keys(imageDimensions);

export const models: Record<string, CatalogueEntry> = {
  "studio-print": {
    id: "studio-print",
    label: "Studio Print",
    provider: PROVIDER_CLOUDFLARE,
    endpoint: "@cf/leonardo/lucid-origin",
    kind: "image",
    description: "Paper-cut editorial illustration with warm grounds and room for a headline.",
    aspects: imageAspects,
    references: 0,
    costMicro: 25_000,
    costBasis: "Cloudflare Workers AI estimate for one Lucid Origin still; not an invoice.",
  },
  "studio-film": {
    id: "studio-film",
    label: "Studio Film",
    provider: PROVIDER_CLOUDFLARE,
    endpoint: "@cf/leonardo/phoenix-1.0",
    kind: "image",
    description: "Screenprinted cinematic frames with deep shadows and a strong single accent.",
    aspects: imageAspects,
    references: 0,
    costMicro: 20_000,
    costBasis: "Cloudflare Workers AI estimate for one Phoenix still; not an invoice.",
  },
  "studio-craft": {
    id: "studio-craft",
    label: "Studio Draft · FLUX.2 Klein 9B",
    provider: PROVIDER_CLOUDFLARE,
    endpoint: "@cf/black-forest-labs/flux-2-klein-9b",
    kind: "image",
    description: "Fast photographic draft for product plates and lighting tests, on FLUX.2 Klein 9B.",
    aspects: imageAspects,
    references: 0,
    costMicro: 16_000,
    costBasis: "Cloudflare Workers AI list price: US$0.015 for the first output megapixel plus US$0.002 per extra megapixel. A 1024 × 1280 still is 1.25 MP, so this estimate rounds up to US$0.016. Not an invoice.",
  },
  "studio-detail": {
    id: "studio-detail",
    label: "Studio Detail",
    provider: PROVIDER_CLOUDFLARE,
    endpoint: "@cf/black-forest-labs/flux-2-klein-4b",
    kind: "image",
    description: "Reference-guided square variation that takes palette, line quality and subject cues from one selected still. It does not promise identical composition or pixels.",
    aspects: ["square"],
    references: 1,
    costMicro: 6_000,
    costBasis: "Cloudflare Workers AI estimate for one FLUX.2 klein still; not an invoice.",
  },
  "studio-quick": {
    id: "studio-quick",
    label: "Studio Quick",
    provider: PROVIDER_CLOUDFLARE,
    endpoint: "@cf/black-forest-labs/flux-1-schnell",
    kind: "image",
    description: "Cheapest square draft for exploring a direction.",
    aspects: ["square"],
    references: 0,
    costMicro: 700,
    costBasis: "Cloudflare Workers AI estimate for one schnell still; not an invoice.",
  },
  "hailuo-standard": {
    id: "hailuo-standard",
    label: "Hailuo 2.3 Standard",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/minimax/hailuo-2.3/standard/image-to-video",
    kind: "video",
    description: "Asynchronous image-to-video with a six or ten second clip.",
    aspects: ["from-image"],
    references: 1,
    durations: [6, 10],
    costMicro: 280_000,
    costPerSecondMicro: 46_667,
    durationCostsMicro: { 6: 280_000, 10: 560_000 },
    costBasis: "fal.ai lists US$0.28 for six seconds and US$0.56 for ten; checked 14 November 2026. Provider billing may change.",
  },
  "h3-max-turbo": {
    id: "h3-max-turbo",
    label: "MiniMax H3 Max Turbo · 768p",
    provider: PROVIDER_FAL,
    endpoint: "minimax/h3-max-turbo/image-to-video",
    kind: "video",
    description: "Animate a selected still into a 5, 10 or 15 second 768p video. Availability and funding depend on this studio’s provider account.",
    aspects: ["from-image"],
    references: 1,
    durations: [5, 10, 15],
    costMicro: 240_000,
    durationCostsMicro: { 5: 240_000, 10: 440_000, 15: 640_000 },
    costBasis: "Conservative estimate at fal.ai's standard US$0.04 per generated second at 768p, with one extra second reserved because output can run longer. A temporary promotion may reduce the invoice; provider billing can change. Pricing checked 14 November 2026.",
  },
  "kling-standard": {
    id: "kling-standard",
    label: "Kling 2.5 Turbo Pro",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    kind: "video",
    description: "Higher-motion asynchronous image-to-video, five or ten seconds.",
    aspects: ["from-image"],
    references: 1,
    durations: [5, 10],
    costMicro: 350_000,
    costPerSecondMicro: 70_000,
    costBasis: "fal.ai review estimate for a five second clip; check current fal pricing before relying on it.",
  },
  "kling-o1-restyle": {
    id: "kling-o1-restyle", label: "Kling O1 footage edit", provider: PROVIDER_FAL,
    endpoint: "fal-ai/kling-video/o1/video-to-video/edit", kind: "video", restyle: true,
    description: "Edit a saved clip using a written direction.", references: 0, aspects: [],
    costMicro: 168_000, costBasis: "fal.ai lists US$0.168 per input second; reserved by rounding up to a whole second. Provider billing may change.",
  },
  "studio-score": {
    id: "studio-score",
    label: "Studio Score",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/stable-audio",
    kind: "audio",
    description:
      "An original music or atmosphere bed from a written description, 10 to 30 seconds long. Instrumental, generated for this studio.",
    audio: { mode: "music", minSeconds: 10, maxSeconds: 30 },
    references: 0,
    costMicro: 15_000,
    costBasis:
      "fal.ai estimate per second of Stable Audio, shown against the length you choose; confirm current fal pricing before relying on it.",
  },
  "studio-voice": {
    id: "studio-voice",
    label: "Studio Voice",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/elevenlabs/tts/eleven-v3",
    kind: "audio",
    description:
      "Spoken narration from your own script, using ElevenLabs' voice model through fal.ai. Use text you wrote or have the rights to.",
    audio: { mode: "speech", maxChars: 1200 },
    references: 0,
    costMicro: 60_000,
    costBasis:
      "fal.ai estimate for one short ElevenLabs narration; the fal invoice, not this figure, is authoritative.",
  },
  "studio-effect": {
    id: "studio-effect",
    label: "Studio Effect",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/elevenlabs/sound-effects/v3",
    kind: "audio",
    description:
      "One short sound effect or atmosphere cue from a written description, using ElevenLabs' sound-effects model through fal.ai. Saved as its own asset so it can be mixed separately.",
    audio: { mode: "effect", minSeconds: 1, maxSeconds: 15 },
    references: 0,
    costMicro: 8_000,
    costBasis:
      "Planning estimate for one short fal-hosted ElevenLabs sound effect; the fal invoice is authoritative.",
  },
  "studio-fill": {
    id: "studio-fill",
    label: "Studio Fill",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/flux-pro/v1/fill",
    kind: "image",
    edit: "fill",
    description:
      "A real masked fill or outpaint: paint the area to change, describe what belongs there, and FLUX Fill returns a new still. The original, mask and result are kept separately.",
    aspects: ["match-reference"],
    references: 1,
    mask: true,
    costMicro: 50_000,
    costBasis:
      "Planning estimate for one FLUX.1 Fill request on fal.ai; confirm current fal pricing before relying on it.",
  },
  "studio-cutout": {
    id: "studio-cutout",
    label: "Studio Cutout",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/birefnet/v2",
    kind: "image",
    edit: "cutout",
    description:
      "Background removal with a transparent PNG result, produced from the selected still. The original stays untouched.",
    aspects: ["match-reference"],
    references: 1,
    promptRequired: false,
    costMicro: 2_000,
    costBasis:
      "Planning estimate for one BiRefNet request on fal.ai; the fal invoice is authoritative.",
  },
  "studio-upscale": {
    id: "studio-upscale",
    label: "Studio Upscale",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/clarity-upscaler",
    kind: "image",
    edit: "upscale",
    description:
      "A two-times upscale of the selected still with a deterministic record of the source. It enhances detail; it does not invent missing footage.",
    aspects: ["match-reference"],
    references: 1,
    promptRequired: false,
    costMicro: 20_000,
    costBasis:
      "Planning estimate for one Clarity Upscaler request on fal.ai; the fal invoice is authoritative.",
  },
  "studio-assembly": {
    id: "studio-assembly",
    label: "Studio Assembly",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/ffmpeg-api/compose",
    kind: "video",
    render: "assembly",
    description:
      "Assemble the ordered shots and an optional audio bed into one bounded, playable export.",
    aspects: ["assembly"],
    references: 0,
    costMicro: 20_000,
    costBasis:
      "fal.ai estimate for one bounded ffmpeg composition; confirm current fal pricing before relying on it.",
  },
  "studio-social": {
    id: "studio-social",
    label: "Studio 9:16 Cut",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/ffmpeg-api/compose",
    kind: "video",
    render: "social",
    description:
      "A true 720 × 1280 cut of the same takes and audio bed. A generated one-second vertical slate opens the cut; the selected shot order is preserved and the takes are fitted into the 9:16 frame rather than reordered.",
    aspects: ["social"],
    references: 0,
    costMicro: 520_000,
    costBasis:
      "One Wan 2.5 720p vertical slate video (5 s at the published US$0.10/s, about US$0.50) plus one bounded compose with the selected takes and sound. The slate is saved and reused by later renders of the same storyboard; this is an estimate, not an invoice.",
  },
};

/**
 * Models that existing jobs and saved briefs may still name, but that must not
 * be offered for new work. The endpoint stays here so an old job keeps its exact
 * provider attribution even after the live catalogue moves on.
 */
export const retiredModels: Record<string, RetiredCatalogueEntry> = {
  "studio-draft": {
    id: "studio-draft",
    label: "Studio Draft · SDXL Lightning (retired)",
    provider: PROVIDER_CLOUDFLARE,
    endpoint: "@cf/bytedance/stable-diffusion-xl-lightning",
    kind: "image",
    retiredAt: "2026-11-20",
    replacement: "studio-craft",
    reason:
      "Cloudflare's planned deprecation date for SDXL Lightning is 20 November 2026. New work uses Studio Draft · FLUX.2 Klein 9B; saved results keep this attribution.",
  },
};
