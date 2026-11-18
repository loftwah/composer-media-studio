// MIT. The public VideoObject JSON-LD builder for listed watch pages.

const PUBLIC_VIDEO_MIME = new Set(["video/mp4", "video/webm"]);

interface VideoObjectJsonLdInput {
  kind: unknown;
  listed: unknown;
  title: unknown;
  description?: unknown;
  poster: unknown;
  media: unknown;
  mime: unknown;
  publishedAt: unknown;
  pageUrl: string;
}

interface VideoObjectSchema {
  "@context": string;
  "@type": string;
  name: string;
  thumbnailUrl: string;
  contentUrl: string;
  uploadDate: string;
  description?: string;
}

export function videoObjectJsonLd({
  kind,
  listed,
  title,
  description,
  poster,
  media,
  mime,
  publishedAt,
  pageUrl,
}: VideoObjectJsonLdInput): string {
  if (kind !== "video" || !listed || typeof mime !== "string" || !PUBLIC_VIDEO_MIME.has(mime)) return "";
  if (typeof title !== "string" || !title.trim()) return "";
  if (typeof poster !== "string" || !poster.startsWith("/p/")) return "";
  if (typeof media !== "string" || !media.startsWith("/p/")) return "";
  if (typeof publishedAt !== "number" || !Number.isSafeInteger(publishedAt) || publishedAt <= 0) return "";
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) return "";
  try {
    const origin = new URL(pageUrl).origin;
    const thumbnail = new URL(poster, pageUrl);
    const content = new URL(media, pageUrl);
    if (!origin.startsWith("https://") || thumbnail.origin !== origin || content.origin !== origin) return "";
    const schema: VideoObjectSchema = {
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: title,
      thumbnailUrl: thumbnail.href,
      contentUrl: content.href,
      uploadDate: published.toISOString(),
    };
    if (typeof description === "string" && description.trim()) schema.description = description;
    // Escaping `<`, `>` and `&` as JSON unicode escapes prevents a public title
    // from closing the <script> element; JSON.parse still yields the original.
    const json = JSON.stringify(schema).replace(/[<>&]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
    return `<script type="application/ld+json">${json}</script>`;
  } catch {
    // An unusable origin/page URL means the absolute URLs are unknown: omit.
    return "";
  }
}
