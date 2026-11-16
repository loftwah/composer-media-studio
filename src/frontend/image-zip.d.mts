export const ZIP_MIME: string;
export function crc32(bytes: Uint8Array, seed?: number): number;

export type ZipEntryInput = {
  name: string;
  data: Uint8Array | ArrayBuffer | ArrayBufferView | string;
  date?: Date;
};

export type ZipResult =
  | { ok: true; bytes: Uint8Array; entries: string[] }
  | { ok: false; error: string };

export function createZip(
  entries: ZipEntryInput[],
  options?: {
    date?: Date;
    maxEntries?: number;
    maxTotalBytes?: number;
  },
): ZipResult;
