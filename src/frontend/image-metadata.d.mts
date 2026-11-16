export class ImageMetadataError extends Error {}

export type ImageSniff = {
  mime: string | null;
  format: string | null;
  supported: boolean;
  activeContent: boolean;
  reason: string | null;
};

export type ExifSummary = {
  present: boolean;
  bytes: number;
  orientation: number | null;
  camera: { make: string | null; model: string | null } | null;
  gps: boolean;
  dateTime: string | null;
  entries: number;
  error: string | null;
};

export type MetadataFlag = { present: boolean; bytes: number };
export type TextMetadata = { present: boolean; count: number };
export type OtherMetadata = {
  present: boolean;
  count: number;
  labels: Array<{ label: string; count: number }>;
};

export type ImageMetadataSummary = {
  mime: string;
  format: "jpeg" | "png" | "webp";
  width: number;
  height: number;
  orientation: number;
  orientedWidth: number;
  orientedHeight: number;
  alpha: boolean;
  exif: ExifSummary;
  gps: boolean;
  camera: { make: string | null; model: string | null } | null;
  xmp: MetadataFlag;
  icc: MetadataFlag;
  text: TextMetadata;
  other: OtherMetadata;
  hasMetadata: boolean;
  notes: string[];
  bitDepth?: number;
  colorType?: number;
};

export type StripResult = {
  bytes: Uint8Array;
  format: "jpeg" | "png" | "webp";
  mime: string;
  before: ImageMetadataSummary;
  after: ImageMetadataSummary;
  removed: string[];
  changed: boolean;
  keptOrientation: boolean;
  warning: string | null;
  verified: {
    pixelsUnchanged: boolean;
    dimensionsMatch: boolean;
    metadataRemoved: boolean;
    all: boolean;
  };
};

export function sniffLocalImage(bytes: Uint8Array): ImageSniff;
export function inspectImage(bytes: Uint8Array): ImageMetadataSummary;
export function stripImageMetadata(
  bytes: Uint8Array,
  options?: { keepColorProfile?: boolean },
): StripResult;
