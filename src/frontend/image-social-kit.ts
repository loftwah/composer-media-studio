export const SOCIAL_SIZES = Object.freeze([
  Object.freeze({ key: "square", aspect: "square", label: "1:1 square", width: 1080, height: 1080 } as const),
  Object.freeze({ key: "portrait", aspect: "portrait", label: "4:5 portrait", width: 1080, height: 1350 } as const),
  Object.freeze({ key: "story", aspect: "tall", label: "9:16 story", width: 1080, height: 1920 } as const),
  Object.freeze({ key: "landscape", aspect: "wide", label: "16:9 landscape", width: 1920, height: 1080 } as const),
]);

/**
 * Per-size editor settings. Crop position, rotation, straighten, resampling
 * and adjustments carry over from the current controls; only the aspect and
 * exact output size change, and the format is always alpha-safe WebP.
 */
type SocialSize = (typeof SOCIAL_SIZES)[number];

export function socialKitSettings<T extends object>(base: T, size: SocialSize, quality: number) {
  return {
    ...base,
    resizeMode: "exact" as const,
    exactWidth: size.width,
    exactHeight: size.height,
    cropAspect: size.aspect,
    format: "webp" as const,
    quality,
    targetKiB: null,
  };
}
