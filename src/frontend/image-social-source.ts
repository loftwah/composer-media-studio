const PUBLIC_POSTER_PATH = /^\/p\/([A-Za-z0-9_-]{1,128})\/(poster|thumb)$/;
const PUBLIC_STILL_PATH = /^\/p\/([A-Za-z0-9_-]{1,128})\/media$/;
const PUBLIC_STILL_HASH = /^#public-still=([A-Za-z0-9_-]{1,128})$/;
const PUBLIC_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export function sourceFilmPath(poster: string): string | null {
  const match = PUBLIC_POSTER_PATH.exec(poster);
  return match ? `/p/${match[1]}` : null;
}

/**
 * The published still page is the stable public record; only its own fixed
 * `/media` attachment may enter the editor. The hash must be the whole fragment
 * so a second source, a parameter or a lookalike path is refused rather than
 * silently ignored.
 */
export function publicStillFromHash(hash: string): string | null {
  const match = PUBLIC_STILL_HASH.exec(hash);
  return match?.[0] === hash ? `/p/${match[1]}/media` : null;
}

export function publishedStillToolUrl(slug: string): string | null {
  return PUBLIC_ID.exec(slug)?.[0] === slug ? `/tools/images#public-still=${slug}` : null;
}

export function sourceStillPath(media: string): string | null {
  const match = PUBLIC_STILL_PATH.exec(media);
  return match ? `/p/${match[1]}` : null;
}

function sourceManifestEntry(
  kind: "poster" | "still",
  publication: string,
  source: string,
  sourceHash: string,
  studioOrigin: string,
): { name: string; data: Uint8Array } | null {
  if (!SHA256_HEX.test(sourceHash) || !URL.canParse(studioOrigin)) return null;
  const origin = new URL(studioOrigin);
  if (origin.origin !== studioOrigin || !["http:", "https:"].includes(origin.protocol)) return null;
  const manifest = {
    schema: kind === "poster" ? "media-studio/social-source-manifest" : "media-studio/still-source-manifest",
    version: 1,
    source: {
      [kind === "poster" ? "film" : "publication"]: new URL(publication, origin).href,
      [kind === "poster" ? "poster" : "media"]: new URL(source, origin).href,
      sha256: sourceHash,
    },
  };
  return {
    name: "source-manifest.json",
    data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  };
}

export function socialSourceManifestEntry({
  poster,
  sourceHash,
  studioOrigin,
}: {
  poster: string;
  sourceHash: string;
  studioOrigin: string;
}): { name: string; data: Uint8Array } | null {
  const film = sourceFilmPath(poster);
  return film ? sourceManifestEntry("poster", film, poster, sourceHash, studioOrigin) : null;
}

export function stillSourceManifestEntry({
  media,
  sourceHash,
  studioOrigin,
}: {
  media: string;
  sourceHash: string;
  studioOrigin: string;
}): { name: string; data: Uint8Array } | null {
  const publication = sourceStillPath(media);
  return publication ? sourceManifestEntry("still", publication, media, sourceHash, studioOrigin) : null;
}
