export const MAX_IMAGE_INPUT_BYTES: number;
export const MAX_DECODED_PIXELS: number;
export const MAX_SOURCE_DIMENSION: number;
export const MAX_IMAGE_OUTPUT_DIMENSION: number;
export const MAX_IMAGE_OUTPUT_BYTES: number;
export const MAX_BATCH_IMAGES: number;
export const MAX_ZIP_ENTRIES: number;
export const MAX_ZIP_BYTES: number;
export const ACCEPTED_IMAGE_MIMES: readonly string[];
export const IMAGE_ACCEPT_ATTRIBUTE: string;

export function imageInputProblem(input?: {
  name?: string;
  type?: string;
  size?: number;
}): string | null;
export function imagePixelProblem(width: number, height: number): string | null;
export function batchCountProblem(count: number): string | null;
