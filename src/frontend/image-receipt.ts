// A local, portable record of one completed Image Tools render. It is derived
// only from the in-memory result snapshot and the source hash. It never reads
// the image bytes, the source filename/path, EXIF or any live editor state, and
// nothing is saved or uploaded. Keep it dependency-free so it can be tested
// outside the browser (see image-receipt.test.mjs for the exact shape).

export const IMAGE_RECEIPT_SCHEMA = "media-studio/image-receipt";
export const IMAGE_RECEIPT_VERSION = 1;

// Keep the versioned settings stable as the editor acquires new controls.
const SETTINGS = [
  "resizeMode", "longEdge", "exactWidth", "exactHeight", "cropAspect",
  "cropAnchor", "rotate", "flipH", "flipV", "straighten", "resample",
  "adjust", "format", "quality", "targetKiB", "matte",
] as const;

type ReceiptSettings = Record<(typeof SETTINGS)[number], unknown>;

export type ImageReceiptInput = {
  sourceHash: string;
  result: {
    plan: object;
    settings: ReceiptSettings;
    width: number;
    height: number;
    mime: string;
    bytes: number;
    sha256: string;
  };
};

export type ImageReceipt = {
  schema: string;
  version: number;
  note: string;
  source: { sha256: string };
  transform: { plan: object; settings: object };
  output: { width: number; height: number; mime: string; bytes: number; sha256: string };
};

export function buildImageReceipt({ sourceHash, result }: ImageReceiptInput): ImageReceipt {
  return {
    schema: IMAGE_RECEIPT_SCHEMA,
    version: IMAGE_RECEIPT_VERSION,
    note: "Hashes and settings for the completed local render.",
    source: { sha256: sourceHash },
    transform: {
      plan: result.plan,
      settings: Object.fromEntries(SETTINGS.map((name) => [name, result.settings[name]])),
    },
    output: {
      width: result.width,
      height: result.height,
      mime: result.mime,
      bytes: result.bytes,
      sha256: result.sha256,
    },
  };
}
