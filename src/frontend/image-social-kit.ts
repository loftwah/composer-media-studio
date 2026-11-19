export const SOCIAL_SIZES = Object.freeze([
  Object.freeze({ key: "square", aspect: "square", label: "1:1 square", width: 1080, height: 1080 } as const),
  Object.freeze({ key: "portrait", aspect: "portrait", label: "4:5 portrait", width: 1080, height: 1350 } as const),
  Object.freeze({ key: "story", aspect: "tall", label: "9:16 story", width: 1080, height: 1920 } as const),
  Object.freeze({ key: "landscape", aspect: "wide", label: "16:9 landscape", width: 1920, height: 1080 } as const),
]);

/** The four-size kit offers one explicit choice; WebP stays the default. */
export const SOCIAL_KIT_FORMATS = Object.freeze(["webp", "png"] as const);
export type SocialKitFormat = (typeof SOCIAL_KIT_FORMATS)[number];
export type SocialSizeKey = (typeof SOCIAL_SIZES)[number]["key"];

export const SOCIAL_POST_LIMITS = { caption: 1500, altText: 500 } as const;
export type SocialPostText = Partial<Record<keyof typeof SOCIAL_POST_LIMITS, string>>;

export function socialPostEntries(post?: SocialPostText) {
  const entries: Array<{ name: string; data: Uint8Array }> = [];
  const encoder = new TextEncoder();
  for (const [key, name] of [["caption", "post.txt"], ["altText", "alt.txt"]] as const) {
    const text = post?.[key]?.slice(0, SOCIAL_POST_LIMITS[key]);
    if (text?.trim()) entries.push({ name, data: encoder.encode(text) });
  }
  return entries;
}

export function socialSourceEligible(
  mime: string | undefined,
  isPublicPoster: boolean,
  webpAnimated?: boolean,
): boolean {
  return isPublicPoster || mime === "image/png" || mime === "image/jpeg" ||
    (mime === "image/webp" && webpAnimated === false);
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
 * One size's crop position. A blank choice (undefined, the native "Use editor"
 * option) keeps the editor's position. A size may pick any of the existing crop
 * anchors without changing the other three, so story and landscape no longer
 * have to share one position. Choices are resolved once for a build, before any
 * encode, so every output and its receipt capture the same four positions.
 */
export function socialKitCropAnchor<TAnchor>(
  choices: Partial<Record<SocialSizeKey, TAnchor>> | undefined,
  key: SocialSizeKey,
  editorAnchor: TAnchor,
): TAnchor {
  return choices?.[key] ?? editorAnchor;
}

/**
 * Per-size editor settings. Rotation, straighten, resampling and adjustments
 * carry over from the current controls; only the aspect and exact output size
 * change. The caller resolves each size's crop position into `base` before
 * calling, so the four outputs can differ while everything else is shared.
 * The caller chooses an explicit alpha-safe output format, normally via
 * `defaultSocialKitFormat`. A forced WebP request in a browser without a WebP
 * encoder is still refused by the exporter's byte check.
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
