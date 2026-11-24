// MIT. The portable draft is a bounded JSON header followed by the original
// file bytes in pair order. Blob slices retain those bytes without base64 or
// allocating memory for all three source images at once.
import { imageInputProblem, MAX_IMAGE_INPUT_BYTES } from "./image-limits.ts";
import { CROP_ANCHOR_LABELS, type CropAnchorKey } from "./image-ops.ts";
import {
  ALT_MAX_LENGTH, HYPOTHESIS_MAX_LENGTH, NOTE_MAX_LENGTH, PAIR_IDS,
  TITLE_MAX_LENGTH, type PairId,
} from "./image-title-compare-plan.ts";

const format = "media-studio-packaging-draft";
const maxHeaderBytes = 32 * 1024;
const prefixBytes = 4;
export const titleCompareDraftName = "media-studio-packaging.studio-draft";

export type TitleDraftPair = {
  title: string;
  alt: string;
  hypothesis: string;
  note: string;
  anchor: CropAnchorKey;
  file: File | null;
};

type TitleDraft = {
  pairs: TitleDraftPair[];
  selectedId: PairId;
  preferredId: PairId | null;
};

function safeFileName(name: string): string {
  return name.replace(/[^.\p{L}\p{N} _-]/gu, "_").slice(-160) || "thumbnail";
}

export function saveTitleDraft(draft: TitleDraft): Blob {
  const pairs = draft.pairs.map(({ file, ...text }) => ({
    ...text,
    image: file ? { name: safeFileName(file.name), type: file.type, size: file.size } : null,
  }));
  const header = new TextEncoder().encode(JSON.stringify({
    format, version: 1, selectedId: draft.selectedId, preferredId: draft.preferredId, pairs,
  }));
  const prefix = new ArrayBuffer(prefixBytes);
  new DataView(prefix).setUint32(0, header.byteLength);
  return new Blob([prefix, header, ...draft.pairs.flatMap(({ file }) => file ? [file] : [])]);
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isPairId(value: unknown): value is PairId {
  return typeof value === "string" && PAIR_IDS.some(id => id === value);
}

function boundedText(value: unknown, length: number): value is string {
  return typeof value === "string" && value.length <= length;
}

export async function readTitleDraft(source: Blob): Promise<TitleDraft | null> {
  if (source.size <= prefixBytes || source.size > prefixBytes + maxHeaderBytes + PAIR_IDS.length * MAX_IMAGE_INPUT_BYTES)
    return null;
  const prefix = new DataView(await source.slice(0, prefixBytes).arrayBuffer());
  const headerBytes = prefix.getUint32(0);
  let offset = prefixBytes + headerBytes;
  if (!headerBytes || headerBytes > maxHeaderBytes || offset > source.size) return null;

  let header: Record<string, unknown> | null;
  try {
    header = object(JSON.parse(await source.slice(prefixBytes, offset).text()));
  } catch {
    return null;
  }
  if (!header || header.format !== format || header.version !== 1) return null;
  const { selectedId, preferredId } = header;
  if (!isPairId(selectedId) || (preferredId !== null && !isPairId(preferredId))) return null;
  if (!Array.isArray(header.pairs) || header.pairs.length !== PAIR_IDS.length) return null;

  const pairs: TitleDraftPair[] = [];
  for (const entry of header.pairs) {
    const pair = object(entry);
    if (!pair) return null;
    const { title, alt, hypothesis, note, anchor } = pair;
    if (!boundedText(title, TITLE_MAX_LENGTH) || !boundedText(alt, ALT_MAX_LENGTH)
      || !boundedText(hypothesis, HYPOTHESIS_MAX_LENGTH) || !boundedText(note, NOTE_MAX_LENGTH)
      || typeof anchor !== "string" || !Object.hasOwn(CROP_ANCHOR_LABELS, anchor)) return null;
    let file = null;
    if (pair.image !== null) {
      const image = object(pair.image);
      if (!image) return null;
      const { name, size, type } = image;
      if (typeof name !== "string" || name !== safeFileName(name)
        || typeof type !== "string" || type.length > 64
        || typeof size !== "number" || !Number.isSafeInteger(size)
        || offset + size > source.size || imageInputProblem({ name, type, size })) return null;
      file = new File([source.slice(offset, offset + size)], name, { type });
      offset += size;
    }
    pairs.push({ title, alt, hypothesis, note, anchor: anchor as CropAnchorKey, file });
  }
  if (offset !== source.size) return null;
  if (preferredId !== null) {
    const preferred = pairs[PAIR_IDS.indexOf(preferredId)];
    if (!preferred.file || !preferred.title.trim()) return null;
  }
  return { selectedId, preferredId, pairs };
}
