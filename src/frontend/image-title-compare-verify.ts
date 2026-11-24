// MIT. Browser-local check that one exported packaging PNG matches the
// versioned Title + thumbnail compare manifest written beside it. It reads only
// the files the visitor selects, validates the manifest's small fact subset
// and compares the PNG's own type, byte length, dimensions and SHA-256. After a
// PNG match, an optional original thumbnail can be compared with the manifest's
// additive source.sha256. Nothing is uploaded, persisted or changed, and a match
// says nothing about who made or owns the image, where the original came from,
// or any rights, asset or audience approval.

import { sha256Hex } from "../lib/util.mjs";
import { MAX_IMAGE_INPUT_BYTES, imageInputProblem } from "./image-limits.ts";
import { inspectImage, sniffLocalImage } from "./image-metadata.ts";
import {
  FEED_SIZES,
  MANIFEST_SCHEMA,
  MANIFEST_VERSION,
  TITLE_MAX_LENGTH,
  type FeedSize,
} from "./image-title-compare-plan.ts";

export const MAX_PACKAGING_MANIFEST_BYTES = 32 * 1024;

const SHA256 = /^[a-f0-9]{64}$/;

/** The manifest facts this check is allowed to read and show. Deliberately no
 * title, note, source name, PNG filename or other free text. A missing source
 * digest is legacy-compatible; null means the supplied digest was invalid. */
export type PackagingManifestFacts = {
  size: FeedSize;
  width: number;
  height: number;
  pngBytes: number;
  sha256: string;
  sourceSha256?: string | null;
};

/** The independent result for an optional original thumbnail. It never changes
 * the PNG outcome or makes a rights, asset or audience claim. */
export type PackagingOriginalOutcome =
  | { status: "matched" }
  | { status: "different" }
  | { status: "legacy" }
  | { status: "invalid"; message: string };

export type PackagingVerifyOutcome =
  | { status: "matched"; facts: PackagingManifestFacts; original?: PackagingOriginalOutcome }
  | {
      status: "different";
      reason: "size";
      facts: PackagingManifestFacts;
      actualBytes: number;
    }
  | {
      status: "different";
      reason: "dimensions";
      facts: PackagingManifestFacts;
      actualBytes: number;
      actualWidth: number;
      actualHeight: number;
    }
  | {
      status: "different";
      reason: "sha256";
      facts: PackagingManifestFacts;
      actualBytes: number;
      actualWidth: number;
      actualHeight: number;
    }
  | { status: "invalid"; message: string };

function invalid(message: string): PackagingVerifyOutcome {
  return { status: "invalid", message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class PackagingManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackagingManifestError";
  }
}

/** Parse one bounded, exact v1 packaging manifest without echoing its text. */
function parsePackagingManifestValue(text: string): Record<string, unknown> {
  if (typeof text !== "string" || text === "")
    throw new PackagingManifestError("Choose the packaging manifest JSON file.");
  if (new TextEncoder().encode(text).byteLength > MAX_PACKAGING_MANIFEST_BYTES)
    throw new PackagingManifestError("Choose a packaging manifest JSON file of 32 KiB or less.");

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PackagingManifestError("That manifest JSON could not be read.");
  }
  if (!isRecord(value))
    throw new PackagingManifestError("That file is not a packaging manifest.");
  if (value.schema !== MANIFEST_SCHEMA)
    throw new PackagingManifestError("That file is not a Title + thumbnail compare packaging manifest.");
  if (value.version !== MANIFEST_VERSION)
    throw new PackagingManifestError(`Only packaging manifest version ${MANIFEST_VERSION} is supported here.`);
  return value;
}

/**
 * Read only the versioned facts this check can compare. Every failure is an
 * invalid input rather than a guess, and no manifest text is echoed back.
 */
export function parsePackagingManifest(text: string): PackagingManifestFacts {
  const value = parsePackagingManifestValue(text);

  const render = value.render;
  if (!isRecord(render))
    throw new PackagingManifestError("That manifest does not contain the exported PNG facts.");
  if (render.format !== "image/png")
    throw new PackagingManifestError("That manifest does not name a PNG export.");

  const size = FEED_SIZES.find(
    (candidate) =>
      candidate.key === render.sizeKey &&
      candidate.width === render.width &&
      candidate.height === render.height,
  );
  if (!size)
    throw new PackagingManifestError("That manifest names a PNG size this workbench does not support.");

  const png = render.png;
  if (!isRecord(png))
    throw new PackagingManifestError("That manifest does not contain the exported PNG facts.");
  const pngBytes = png.bytes;
  if (
    typeof pngBytes !== "number" ||
    !Number.isSafeInteger(pngBytes) ||
    pngBytes < 1 ||
    pngBytes > MAX_IMAGE_INPUT_BYTES
  )
    throw new PackagingManifestError(
      `That manifest names an unsupported PNG byte size (limit ${MAX_IMAGE_INPUT_BYTES / 1024 / 1024} MiB).`,
    );
  const sha256 = png.sha256;
  if (typeof sha256 !== "string" || !SHA256.test(sha256))
    throw new PackagingManifestError("That manifest does not carry a valid lowercase SHA-256 digest.");

  const sourceSha256 =
    isRecord(value.source) && value.source.sha256 !== undefined
      ? typeof value.source.sha256 === "string" && SHA256.test(value.source.sha256)
        ? value.source.sha256
        : null
      : undefined;

  return {
    size,
    width: size.width,
    height: size.height,
    pngBytes,
    sha256,
    ...(sourceSha256 !== undefined ? { sourceSha256 } : {}),
  };
}

/** The distinct recovery path alone may read the same bounded v1 manifest's
 * title. It stays untrusted plain text: no markup, crop, note, alt text,
 * hypothesis or preference is interpreted or returned. */
export async function readPackagingTitle(
  manifestFile: File | null | undefined,
): Promise<string> {
  if (!manifestFile)
    throw new PackagingManifestError("Choose the packaging manifest JSON file.");
  if (manifestFile.size === 0 || manifestFile.size > MAX_PACKAGING_MANIFEST_BYTES)
    throw new PackagingManifestError("Choose a packaging manifest JSON file of 32 KiB or less.");

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(await manifestFile.arrayBuffer());
  } catch {
    throw new PackagingManifestError("That manifest JSON could not be read.");
  }
  const value = parsePackagingManifestValue(text);
  const title = value.title;
  if (
    !isRecord(title) ||
    typeof title.text !== "string" ||
    title.text.trim() === "" ||
    title.text.length > TITLE_MAX_LENGTH
  )
    throw new PackagingManifestError(
      `That manifest title must be nonblank text of ${TITLE_MAX_LENGTH} characters or fewer.`,
    );
  return title.text;
}

/** Compare the already-parsed facts with the selected PNG bytes. Type, exact
 * byte length, dimensions and digest are checked in that order. */
export async function verifyPackagingBytes(
  facts: PackagingManifestFacts,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<PackagingVerifyOutcome> {
  const sniffed = sniffLocalImage(bytes);
  if (!sniffed.supported || sniffed.format !== "png" || sniffed.mime !== "image/png")
    return invalid("That file is not a PNG. Choose the PNG exported with this manifest.");

  const actualBytes = bytes.byteLength;
  if (actualBytes !== facts.pngBytes)
    return { status: "different", reason: "size", facts, actualBytes };

  let png;
  try {
    png = inspectImage(bytes);
  } catch {
    return invalid("That PNG could not be read. Choose the PNG exported with this manifest.");
  }
  if (png.format !== "png" || png.width !== facts.width || png.height !== facts.height)
    return {
      status: "different",
      reason: "dimensions",
      facts,
      actualBytes,
      actualWidth: png.width,
      actualHeight: png.height,
    };

  let actualSha256: string;
  try {
    actualSha256 = await sha256Hex(bytes);
  } catch {
    return invalid("This browser could not hash the PNG. Try again in a browser with Web Crypto.");
  }
  if (actualSha256 !== facts.sha256)
    return {
      status: "different",
      reason: "sha256",
      facts,
      actualBytes,
      actualWidth: png.width,
      actualHeight: png.height,
    };

  return { status: "matched", facts };
}

/** Compare one already-bounded original with the additive source digest. This
 * runs only after the PNG matched, and its result cannot change that match. */
async function verifyPackagingOriginal(
  facts: PackagingManifestFacts,
  originalFile: File,
  inputProblem: string | null,
): Promise<PackagingOriginalOutcome> {
  if (facts.sourceSha256 === undefined) return { status: "legacy" };
  if (facts.sourceSha256 === null)
    return { status: "invalid", message: "The manifest's source SHA-256 is invalid." };
  if (inputProblem) return { status: "invalid", message: inputProblem };

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await originalFile.arrayBuffer());
  } catch {
    return { status: "invalid", message: "That file could not be read." };
  }
  const sizeProblem = imageInputProblem({ size: bytes.byteLength });
  if (sizeProblem) return { status: "invalid", message: sizeProblem };

  let actualSha256: string;
  try {
    actualSha256 = await sha256Hex(bytes);
  } catch {
    return { status: "invalid", message: "This browser could not hash the original thumbnail." };
  }
  return actualSha256 === facts.sourceSha256
    ? { status: "matched" }
    : { status: "different" };
}

/**
 * The explicit check behind the disclosure. The manifest and PNG are bounded
 * before they are read; the manifest is parsed once for its required subset and
 * optional source digest. The PNG is then compared byte-for-byte and
 * digest-for-digest. Only after a PNG match is an optional original read and
 * hashed locally against source.sha256, with the same image input byte cap.
 */
export async function verifyPackagingFiles(
  manifestFile: File | null | undefined,
  pngFile: File | null | undefined,
  originalFile?: File | null,
): Promise<PackagingVerifyOutcome> {
  if (!manifestFile) return invalid("Choose the packaging manifest JSON file.");
  if (manifestFile.size === 0 || manifestFile.size > MAX_PACKAGING_MANIFEST_BYTES)
    return invalid("Choose a packaging manifest JSON file of 32 KiB or less.");

  if (!pngFile) return invalid("Choose the PNG exported with this manifest.");
  const pngProblem = imageInputProblem({ name: pngFile.name, type: pngFile.type, size: pngFile.size });
  if (pngProblem) return invalid(pngProblem);

  // Preflight the optional original before any selected file is read. A problem
  // is reported only after the required PNG mode has had its independent match.
  const originalProblem = originalFile
    ? imageInputProblem({ name: originalFile.name, type: originalFile.type, size: originalFile.size })
    : null;

  let text: string;
  try {
    text = await manifestFile.text();
  } catch {
    return invalid("That manifest JSON could not be read.");
  }

  let facts: PackagingManifestFacts;
  try {
    facts = parsePackagingManifest(text);
  } catch (error) {
    return invalid(
      error instanceof PackagingManifestError ? error.message : "That manifest JSON could not be read.",
    );
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await pngFile.arrayBuffer());
  } catch {
    return invalid("That PNG could not be read.");
  }
  const outcome = await verifyPackagingBytes(facts, bytes);
  if (outcome.status !== "matched" || !originalFile) return outcome;
  return {
    ...outcome,
    original: await verifyPackagingOriginal(facts, originalFile, originalProblem),
  };
}
