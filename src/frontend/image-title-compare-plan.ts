// MIT. Pure planning logic for the workbench's title + thumbnail compare:
// the feed sizes, the cover-crop plan shared by the CSS preview and the PNG
// export, and the download-name rules. No DOM, no React, no state.

import { CROP_ANCHOR_LABELS, type CropAnchorKey } from "./image-ops.ts";

export const PAIR_IDS = ["a", "b", "c"] as const;
export type PairId = (typeof PAIR_IDS)[number];

export const PAIR_LABELS: Readonly<Record<PairId, string>> = Object.freeze({
  a: "A",
  b: "B",
  c: "C",
});

/** What a pair currently holds, as the duplicate action needs to judge it. The
 * thumbnail is a boolean because the decision is about occupancy, not bytes. */
export type PairOccupancy = {
  title: string;
  /** Optional thumbnail alt text counts as work, like the creator note. */
  alt?: string;
  /** Optional creator-written testing hypothesis counts as work too. */
  hypothesis?: string;
  note: string;
  hasImage: boolean;
  busy: boolean;
  anchor: CropAnchorKey;
};

/** An empty pair has no title, alt text, hypothesis, note, thumbnail, pending
 * decode or crop edit. Older occupancy snapshots without the optional fields
 * still read as empty. */
export function pairIsEmpty(pair: PairOccupancy): boolean {
  return (
    !pair.busy &&
    !pair.hasImage &&
    pair.anchor === "centre" &&
    pair.title.trim() === "" &&
    (pair.alt ?? "").trim() === "" &&
    (pair.hypothesis ?? "").trim() === "" &&
    pair.note.trim() === ""
  );
}

/**
 * The first empty pair other than the source, in A/B/C order; null when every
 * other pair is occupied. Occupancy is read in PAIR_IDS order, the same order
 * the compare grid and its previews use.
 */
export function duplicateTargetPair(
  occupancy: readonly PairOccupancy[],
  sourceId: PairId,
): PairId | null {
  const sourceIndex = PAIR_IDS.indexOf(sourceId);
  if (sourceIndex < 0) return null;
  for (const [index, id] of PAIR_IDS.entries()) {
    if (index === sourceIndex) continue;
    const pair = occupancy[index];
    if (pair && pairIsEmpty(pair)) return id;
  }
  return null;
}

/** The two representative feed scales this slice previews. The card box is
 * exactly 16:9; the row box is the common rounded listing size, a hair
 * taller than 16:9 — which is why the crop plan, not the aspect label, is
 * the shared truth. */
export const FEED_SIZES = Object.freeze([
  Object.freeze({ key: "row", label: "row", width: 168, height: 94 } as const),
  Object.freeze({ key: "card", label: "card", width: 640, height: 360 } as const),
]);
export type FeedSizeKey = (typeof FEED_SIZES)[number]["key"];
export type FeedSize = (typeof FEED_SIZES)[number];

export const TITLE_MAX_LENGTH = 200;

/** Creator notes are optional, bounded plain text. This is the exact cap used
 * by the pair editor and enforced again before a note reaches a manifest, so a
 * note can never make the exported JSON unbounded. */
export const NOTE_MAX_LENGTH = 240;

/** Thumbnail alt text is optional, bounded plain text. A concise description
 * is more useful to a screen-reader listener than a title-length paragraph, so
 * it gets a smaller cap than the creator note; the editor states it visibly. */
export const ALT_MAX_LENGTH = 160;

/** A creator's written expectation for one title + thumbnail pair. It is a
 * private note to oneself, not a score, measurement or experiment result, so it
 * reuses the creator-note bound and normaliser exactly. */
export const HYPOTHESIS_MAX_LENGTH = NOTE_MAX_LENGTH;

/**
 * Normalise a raw note to bounded plain text: CRLF becomes LF, C0/C1 controls
 * and DEL are dropped, the text is trimmed and finally capped. Empty or
 * whitespace-only input yields `undefined`, so an absent note adds no field to
 * the manifest — the same rule preferredPairId uses.
 */
export function normalizeCreatorNote(
  raw: string,
  maxLength: number = NOTE_MAX_LENGTH,
): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw
    .replace(/\r\n?/g, "\n")
    // Deliberately strip control characters from free text; newlines survive.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .trim()
    .slice(0, maxLength)
    .trimEnd();
  return cleaned === "" ? undefined : cleaned;
}

/**
 * Normalise optional thumbnail alt text with the same bounded-plain-text rule
 * a creator note uses. Blank input yields `undefined`, so a pair without alt
 * text adds no field and keeps the older manifest shape and bytes.
 */
export function normalizeThumbnailAlt(
  raw: string,
  maxLength: number = ALT_MAX_LENGTH,
): string | undefined {
  return normalizeCreatorNote(raw, maxLength);
}

/**
 * Normalise the optional testing hypothesis with the same bounded-plain-text
 * rule a creator note uses. Blank input yields `undefined`, so a pair without
 * a hypothesis adds no field and keeps the older manifest shape and bytes.
 */
export function normalizeTestingHypothesis(
  raw: string,
  maxLength: number = HYPOTHESIS_MAX_LENGTH,
): string | undefined {
  return normalizeCreatorNote(raw, maxLength);
}

export type CoverRect = { left: number; top: number; width: number; height: number };

function anchorFractions(anchor: CropAnchorKey): { x: number; y: number } {
  return {
    x: anchor === "left" || anchor === "topLeft" || anchor === "bottomLeft" ? 0
      : anchor === "right" || anchor === "topRight" || anchor === "bottomRight" ? 1
      : 0.5,
    y: anchor === "top" || anchor === "topLeft" || anchor === "topRight" ? 0
      : anchor === "bottom" || anchor === "bottomLeft" || anchor === "bottomRight" ? 1
      : 0.5,
  };
}

/**
 * The whole-pixel source rectangle that `object-fit: cover` shows for a box of
 * `boxWidth × boxHeight`, positioned by the same crop anchors the workbench
 * already uses. A source smaller than the box is scaled up, exactly as the
 * cover preview does. The CSS preview and the exported pixels read one plan,
 * so what the preview crops is what the file contains.
 */
export function coverCropRect(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
  anchor: CropAnchorKey = "centre",
): CoverRect | null {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth < 1 || sourceHeight < 1)
    return null;
  if (!Number.isFinite(boxWidth) || !Number.isFinite(boxHeight) || boxWidth < 1 || boxHeight < 1) return null;
  const scale = Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight);
  const { x, y } = anchorFractions(anchor);
  const width = Math.min(Math.round(boxWidth / scale), sourceWidth);
  const height = Math.min(Math.round(boxHeight / scale), sourceHeight);
  const left = Math.min(Math.round((sourceWidth - width) * x), sourceWidth - width);
  const top = Math.min(Math.round((sourceHeight - height) * y), sourceHeight - height);
  return { left: Math.max(left, 0), top: Math.max(top, 0), width, height };
}

/** The CSS equivalent of the same plan, for the live preview. */
export function objectPositionFor(anchor: CropAnchorKey): string {
  const { x, y } = anchorFractions(anchor);
  return `${x * 100}% ${y * 100}%`;
}

/** One honest label for a prepared-set snapshot whose pairs may hold different
 * crop anchors. Agreement keeps the familiar anchor name; mixed anchors say
 * so rather than claiming one crop for every PNG. */
export function describeExportAnchors(anchors: readonly CropAnchorKey[]): string {
  const first = anchors[0];
  if (first === undefined) return CROP_ANCHOR_LABELS.centre;
  return anchors.every((anchor) => anchor === first) ? CROP_ANCHOR_LABELS[first] : "per-pair";
}

/** The download stem of one export, with the workbench's name rules. */
export function safeTitleStem(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "thumbnail"
  );
}

/** One export's download name, keyed by its feed size. */
export function exportFileName(title: string, fallbackName: string, size: FeedSize): string {
  return `${safeTitleStem(title || fallbackName)}-feed-${size.width}x${size.height}.png`;
}

/** The manifest this slice exports, so a chosen pair can be handed on with the
 * exact facts this tab actually knows: the title text, the source thumbnail's
 * own facts, the crop plan and the identity of the PNG the same run encoded.
 * Version bumps when a required field or its meaning changes; optional additive
 * V1 metadata may appear without changing it. Nothing else here claims a work,
 * rights or performance value this tab cannot know. */
export const MANIFEST_SCHEMA = "studio.title-thumbnail-pair-manifest";
export const MANIFEST_VERSION = 1;

export type ManifestSourceFacts = {
  fileName: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  /** Additive V1 metadata: lowercase SHA-256 of the exact selected source File,
   * present only when explicit manifest/package preparation hashed it. */
  sha256?: string;
};

export type ManifestPngFacts = {
  fileName: string;
  bytes: number;
  sha256: string;
};

export type TitlePairManifest = {
  schema: string;
  version: number;
  generatedAt: string;
  generator: string;
  pair: { id: PairId; label: string };
  /** Additive V1 metadata: present only when a prepared-set snapshot shows a
   * preference and that pair is in the set it names. */
  preferredPairId?: PairId;
  /** Additive V1 metadata, like preferredPairId: present only when the captured
   * pair carried a nonempty creator note. Bounded plain text, browser-local. */
  note?: string;
  /** Additive V1 metadata, like note: present only when the captured pair
   * carried nonblank thumbnail alt text. Bounded plain text, browser-local. */
  alt?: string;
  /** Additive V1 metadata, like note: present only when the captured pair
   * carried a nonblank testing hypothesis. A creator's bounded plain-text
   * expectation, never a measured score or an experiment result. */
  hypothesis?: string;
  title: { text: string; maxLength: number };
  source: ManifestSourceFacts;
  crop: { mode: "cover"; anchor: CropAnchorKey; sourceRect: CoverRect };
  render: {
    sizeKey: FeedSizeKey;
    width: number;
    height: number;
    format: "image/png";
    png: ManifestPngFacts;
  };
  local: { uploaded: false; serverInvolved: false };
};

/** The versioned manifest for one captured pair, built only from facts the
 * component captured from its own encode. */
export function buildTitlePairManifest(input: {
  generatedAt: string;
  pairId: PairId;
  title: string;
  source: ManifestSourceFacts;
  anchor: CropAnchorKey;
  size: FeedSize;
  sourceRect: CoverRect;
  png: ManifestPngFacts;
  /** Omit it when no pair is preferred, so older releases' manifest shape and
   * bytes stay unchanged. */
  preferredPairId?: PairId;
  /** Omit it when the pair has no note, so no-note manifest bytes stay exactly
   * as they were before this optional field existed. */
  note?: string;
  /** Omit it when the pair has no thumbnail alt text, so a no-alt manifest
   * keeps the exact shape and bytes it had before this optional field. */
  alt?: string;
  /** Omit it when the pair has no hypothesis, so a pair without one keeps the
   * exact manifest bytes it had before this optional field existed. */
  hypothesis?: string;
}): TitlePairManifest {
  const note = normalizeCreatorNote(input.note ?? "");
  const alt = normalizeThumbnailAlt(input.alt ?? "");
  const hypothesis = normalizeTestingHypothesis(input.hypothesis ?? "");
  return {
    schema: MANIFEST_SCHEMA,
    version: MANIFEST_VERSION,
    generatedAt: input.generatedAt,
    generator: "Media Studio Image Tools — Title + thumbnail compare (browser-local)",
    pair: { id: input.pairId, label: PAIR_LABELS[input.pairId] },
    ...(input.preferredPairId ? { preferredPairId: input.preferredPairId } : {}),
    ...(note ? { note } : {}),
    ...(alt ? { alt } : {}),
    ...(hypothesis ? { hypothesis } : {}),
    title: { text: input.title, maxLength: TITLE_MAX_LENGTH },
    source: input.source,
    crop: { mode: "cover", anchor: input.anchor, sourceRect: input.sourceRect },
    render: {
      sizeKey: input.size.key,
      width: input.size.width,
      height: input.size.height,
      format: "image/png",
      png: input.png,
    },
    local: { uploaded: false, serverInvolved: false },
  };
}

/** One manifest's download name, versioned beside the PNG it names. */
export function manifestFileName(
  title: string,
  fallbackName: string,
  size: FeedSize,
  version: number = MANIFEST_VERSION,
): string {
  return `${safeTitleStem(title || fallbackName)}-feed-${size.width}x${size.height}-manifest-v${version}.json`;
}

/** The package ZIP's download name: the same stem as the pair it carries, so
 * the archive and the two files inside it stay recognisably one export. */
export function bundleFileName(
  title: string,
  fallbackName: string,
  size: FeedSize,
): string {
  return `${safeTitleStem(title || fallbackName)}-feed-${size.width}x${size.height}-package.zip`;
}

/** Stable flat archive names keep different pairs and long titles unambiguous. */
export function pairArchiveFileNames(pairId: PairId, size: FeedSize): { png: string; manifest: string } {
  const stem = `pair-${pairId}-feed-${size.width}x${size.height}`;
  return { png: `${stem}.png`, manifest: `${stem}-manifest-v${MANIFEST_VERSION}.json` };
}

/** The set export may name a preferred pair only when that pair is in the
 * exact snapshot it is about to export. A stale preference for a pair that was
 * removed, retitled, replaced or skipped is not written into the manifest. */
export function preferredPairForExport(
  preferred: PairId | null,
  exported: readonly PairId[],
): PairId | undefined {
  return preferred !== null && exported.includes(preferred) ? preferred : undefined;
}

/** The one package of prepared pairs. It carries the same store-only flat ZIP
 * the single-pair package uses; the count only keeps separate downloads
 * distinguishable. */
export function preparedPairsBundleFileName(size: FeedSize, count: number): string {
  return `prepared-pairs-${count}-feed-${size.width}x${size.height}-package.zip`;
}

/** A neutral, stable name for the separate reviewer feedback sheet. It never
 * borrows a creator's title or a local thumbnail's file path. */
export const PREPARED_REVIEW_NOTES_FILE_NAME = "prepared-pairs-review-notes.txt";

const REVIEW_DECISION_LINE = "_".repeat(60);

/** Plain-text feedback for the exact finalized set manifests. Titles stay
 * byte-for-byte as captured; optional alt text and hypotheses are the same
 * bounded text the manifests already hold. Crop and size facts come from those
 * manifests, not a later edit. No timestamp, digest, file name, image, markup,
 * score or guessed decision is added, so the same prepared set yields the same
 * text and can be reviewed independently beside its ZIP. */
export function buildPreparedReviewNotes(manifests: readonly TitlePairManifest[]): string {
  const preferred = manifests.find(
    (manifest) => manifest.preferredPairId === manifest.pair.id,
  );
  const heading = ["Title + thumbnail compare — review notes"];
  if (manifests.length > 0) {
    heading.push(`Current preference: ${preferred ? `Pair ${preferred.pair.label}` : "none marked"}`);
  }
  const pairs = manifests.map((manifest) => {
    const { sourceRect } = manifest.crop;
    const lines = [
      `Pair ${manifest.pair.label}`,
      `Title: ${manifest.title.text}`,
      `Crop / size: ${manifest.crop.mode} · ${CROP_ANCHOR_LABELS[manifest.crop.anchor]} · source ${manifest.source.width} × ${manifest.source.height} px · crop ${sourceRect.width} × ${sourceRect.height} px · ${manifest.render.sizeKey} ${manifest.render.width} × ${manifest.render.height} px`,
    ];
    if (manifest.alt) lines.push(`Thumbnail alt text: ${manifest.alt}`);
    if (manifest.hypothesis) lines.push(`Creator hypothesis: ${manifest.hypothesis}`);
    lines.push("Decision:", REVIEW_DECISION_LINE, REVIEW_DECISION_LINE);
    return lines.join("\n");
  });
  return `${heading.join("\n")}${pairs.length > 0 ? `\n\n${pairs.join("\n\n")}` : ""}\n`;
}
