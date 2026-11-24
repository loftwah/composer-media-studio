// MIT. Bounded, browser-local intake for Image Tools embed snippets. This module
// only turns validated bytes into a File; the workbench's existing addFiles path
// remains responsible for header, pixel and browser-decode validation.

import { ACCEPTED_IMAGE_MIMES } from "./image-limits.ts";
import { sniffLocalImage } from "./image-metadata.ts";
import {
  MAX_BASE64_INPUT_CHARACTERS,
  MAX_BASE64_LENGTH,
  MAX_SNIPPET_BYTES,
  base64ToBytes,
} from "./image-snippets.ts";

const DATA_URI_PREFIX = /^data:(image\/png|image\/jpeg|image\/webp);base64,/;
const ORDINARY_WHITESPACE = /[ \t\r\n\f\v]+/g;
const OUTER_WHITESPACE = /^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g;
const EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
});

export type ImageBase64File =
  | Readonly<{ file: File; mime: string; bytes: number }>
  | Readonly<{ problem: string }>;

/** Accept raw Base64 or one exact typed base64 data URI, never a URL or markup. */
export function imageFileFromBase64(text: string): ImageBase64File {
  if (typeof text !== "string")
    return { problem: "Paste Base64 text or a PNG, JPEG or WebP data URI." };
  if (text.length > MAX_BASE64_INPUT_CHARACTERS) {
    return {
      problem: `Base64 input is limited to ${MAX_BASE64_INPUT_CHARACTERS.toLocaleString()} characters, including whitespace.`,
    };
  }
  const value = text.replace(OUTER_WHITESPACE, "");
  if (!value) return { problem: "Paste Base64 text or a PNG, JPEG or WebP data URI." };

  let encoded = value;
  let declaredMime: string | null = null;
  if (/^data:/i.test(value)) {
    const match = DATA_URI_PREFIX.exec(value);
    if (!match) {
      return {
        problem:
          "Use an exact data:image/png;base64, data:image/jpeg;base64, or data:image/webp;base64, prefix.",
      };
    }
    declaredMime = match[1];
    encoded = value.slice(match[0].length);
  }

  const compact = encoded.replace(ORDINARY_WHITESPACE, "");
  if (!compact) return { problem: "Paste Base64 text or a PNG, JPEG or WebP data URI." };
  if (compact.length > MAX_BASE64_LENGTH ||
      (compact.length === MAX_BASE64_LENGTH && !compact.endsWith("="))) {
    return { problem: `The decoded image is limited to ${MAX_SNIPPET_BYTES / 1024 / 1024} MiB.` };
  }
  const bytes = base64ToBytes(compact);
  if (!bytes?.length) {
    return {
      problem: "That is not valid standard Base64. Use padding and ordinary spaces or line breaks.",
    };
  }

  const sniffed = sniffLocalImage(bytes);
  if (!sniffed.supported || !sniffed.mime || !ACCEPTED_IMAGE_MIMES.includes(sniffed.mime)) {
    return {
      problem: sniffed.reason ?? "The decoded bytes are not a JPEG, PNG or WebP image.",
    };
  }
  if (declaredMime && declaredMime !== sniffed.mime) {
    return {
      problem: `The data URI declares ${declaredMime}, but the decoded bytes are ${sniffed.mime}.`,
    };
  }

  return {
    file: new File([bytes], `pasted-image.${EXTENSIONS[sniffed.mime]}`, { type: sniffed.mime }),
    mime: sniffed.mime,
    bytes: bytes.length,
  };
}
