export const SOCIAL_SIZES = Object.freeze([
  Object.freeze({ key: "square", aspect: "square", label: "1:1 square", width: 1080, height: 1080 } as const),
  Object.freeze({ key: "portrait", aspect: "portrait", label: "4:5 portrait", width: 1080, height: 1350 } as const),
  Object.freeze({ key: "story", aspect: "tall", label: "9:16 story", width: 1080, height: 1920 } as const),
  Object.freeze({ key: "landscape", aspect: "wide", label: "16:9 landscape", width: 1920, height: 1080 } as const),
]);

/** The four-size kit offers one explicit choice; WebP stays the default. */
export const SOCIAL_KIT_FORMATS = Object.freeze(["webp", "png"] as const);
export type SocialKitFormat = (typeof SOCIAL_KIT_FORMATS)[number];

export function socialSourceEligible(mime: string | undefined, isPublicPoster: boolean): boolean {
  return mime === "image/png" || mime === "image/jpeg" || isPublicPoster;
}

/**
 * The workbench default follows the one-time Canvas capability probe. A browser
 * that cannot encode WebP starts on lossless PNG instead of wasting a four-size
 * transform on a request that would silently come back as PNG.
 */
export function defaultSocialKitFormat(webpEncodable: boolean): SocialKitFormat {
  return webpEncodable ? "webp" : "png";
}

/**
 * Per-size editor settings. Crop position, rotation, straighten, resampling
 * and adjustments carry over from the current controls; only the aspect and
 * exact output size change. The caller chooses an explicit alpha-safe output
 * format, normally via `defaultSocialKitFormat`. A forced WebP request in a
 * browser without a WebP encoder is still refused by the exporter's byte check.
 */
type SocialSize = (typeof SOCIAL_SIZES)[number];

export function socialKitSettings<T extends object>(
  base: T,
  size: SocialSize,
  quality: number,
  format: SocialKitFormat = "webp",
) {
  return {
    ...base,
    resizeMode: "exact" as const,
    exactWidth: size.width,
    exactHeight: size.height,
    cropAspect: size.aspect,
    format,
    quality,
    targetKiB: null,
  };
}
