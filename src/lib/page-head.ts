// MIT. The shared document <head> and brand mark for every server-rendered
// page: the studio shell, login, public gallery, published pieces, help and
// the private review pages. Runtime stays byte-identical to the former ui.mjs
// definitions; this module only makes that shared chrome a checked source
// file so the strict TypeScript render lanes can reuse it without a circular
// import back into ui.mjs.

import { escapeHtml } from "./util.mjs";

export const brandMark = `<img class="brand-mark" src="/brand/composer-icon-tile.svg" width="40" height="40" alt="">`;

const styles = "/studio.css";

/** The shared head fields. Every optional field is read through the same
 * falsy/typeof checks the untyped call sites have always relied on, so the
 * rendered bytes do not depend on which fields a caller happens to send. */
export interface PageHeadOptions {
  title: string;
  description: string;
  image?: string | null;
  imageAlt?: string | null;
  imageType?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  url?: string | null;
  kind?: string;
  extra?: string;
  theme?: boolean;
  private?: boolean;
}

export function head({
  title,
  description,
  image,
  imageAlt,
  imageType,
  imageWidth,
  imageHeight,
  url,
  kind = "website",
  extra = "",
  theme = true,
  private: isPrivate = false,
}: PageHeadOptions): string {
  const hasImage = Boolean(image) && !isPrivate;
  const width = typeof imageWidth === "number" && Number.isInteger(imageWidth) && imageWidth > 0 ? imageWidth : null;
  const height = typeof imageHeight === "number" && Number.isInteger(imageHeight) && imageHeight > 0 ? imageHeight : null;
  const type = typeof imageType === "string" && imageType.startsWith("image/") ? imageType : null;
  const alt = imageAlt || title;
  const imageTags = hasImage
    ? [
        `<meta property="og:image" content="${escapeHtml(image)}">`,
        type ? `<meta property="og:image:type" content="${escapeHtml(type)}">` : "",
        width ? `<meta property="og:image:width" content="${width}">` : "",
        height ? `<meta property="og:image:height" content="${height}">` : "",
        `<meta property="og:image:alt" content="${escapeHtml(alt)}">`,
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const twitter = [
    `<meta name="twitter:card" content="${hasImage ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    hasImage ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : "",
    hasImage ? `<meta name="twitter:image:alt" content="${escapeHtml(alt)}">` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `<!doctype html>
<html lang="en"${theme ? ' data-theme="light"' : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="theme-color" content="#f4f0e8">
${isPrivate ? '<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer">' : ""}
<link rel="icon" href="/brand/composer-icon-tile.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/composer-icon-tile.svg">
<link rel="preload" href="/brand/space-grotesk.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${styles}">
${theme ? '<script src="/theme.js" defer></script>' : ""}
${isPrivate ? "" : imageTags}
${isPrivate ? "" : `<meta property="og:type" content="${kind}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${url ? `<meta property="og:url" content="${escapeHtml(url)}"><link rel="canonical" href="${escapeHtml(url)}">` : ""}
${twitter}`}
${extra}
</head>`;
}
