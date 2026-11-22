// MIT. The small, dependency-free helpers shared by the worker, job engine and
// tests now live in strict TypeScript (util.ts); this shim keeps the original
// util.mjs import paths for the worker, MCP server, scripts and tests. Every
// import path shares one implementation and one HttpError class identity.

export * from "./util.ts";

// Image, video and audio byte parsing lives in media-metadata.ts with explicit
// types; these re-exports keep the original util.mjs import paths.
export { audioInfo, imageSize, videoInfo } from "./media-metadata.ts";

// Media type sniffing and storage extensions live in media-sniff.ts with
// explicit types; these re-exports keep the original util.mjs import paths.
export { sniffMedia, extensionFor } from "./media-sniff.ts";
