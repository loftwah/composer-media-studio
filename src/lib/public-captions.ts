// MIT. Reviewed captions from Composer's published edition of Take it with you.
export const PUBLIC_CAPTION_ROUTE = "/captions.vtt";

const filmSlug = "PbvQYtyGG-YlF0Dh";
const filmSha256 = "187134b76dc0687d95e263d7b3bb2b7cf6507affb4204e61c2badaeff567d046";
const captions = `WEBVTT

00:00.000 --> 00:00.600 line:12%
[A sharp click]

00:00.600 --> 00:02.050 line:12%
Bring your AI agent.

00:02.050 --> 00:03.650 line:12%
Build an app.

00:03.850 --> 00:07.700 line:12%
[Power-up chime]
Take it with you.
`;

export function reviewedCaptionFor(slug: unknown, sha256: unknown): string | null {
  return slug === filmSlug && sha256 === filmSha256 ? captions : null;
}
