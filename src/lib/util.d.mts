// Types live with the implementations in util.ts, so this file only forwards
// them (plus the typed media modules) and keeps the original util.mjs import
// paths strictly typed for director.ts, publication-derivatives.ts, sitemap.ts
// and the other checked lanes.

export * from "./util.ts";

export { audioInfo, imageSize, videoInfo } from "./media-metadata.ts";

export { extensionFor, sniffMedia } from "./media-sniff.ts";
