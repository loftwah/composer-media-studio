const PUBLIC_POSTER_PATH = /^\/p\/([A-Za-z0-9_-]{1,128})\/(poster|thumb)$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export function sourceFilmPath(poster: string): string | null {
  const match = PUBLIC_POSTER_PATH.exec(poster);
  return match ? `/p/${match[1]}` : null;
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
  if (!film || !SHA256_HEX.test(sourceHash) || !URL.canParse(studioOrigin)) return null;
  const origin = new URL(studioOrigin);
  if (origin.origin !== studioOrigin || !["http:", "https:"].includes(origin.protocol)) return null;
  const manifest = {
    schema: "media-studio/social-source-manifest",
    version: 1,
    source: {
      film: new URL(film, origin).href,
      poster: new URL(poster, origin).href,
      sha256: sourceHash,
    },
  };
  return {
    name: "source-manifest.json",
    data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  };
}
