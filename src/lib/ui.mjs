// MIT. Server-rendered shells. The studio itself is progressive, same-origin JS.

import { videoObjectJsonLd } from "./video-object-json-ld.ts";

// The public VideoObject JSON-LD builder is owned by video-object-json-ld.ts.
// Re-exported so existing ui.mjs import callers keep the exact same module path.
export { videoObjectJsonLd };

// The studio shell, login page and their shared header are owned by
// studio-shell.ts under strict TypeScript. Re-exported so existing ui.mjs
// import callers (the Worker and the focused tests) keep the same module path.
export { shell, loginPage } from "./studio-shell.ts";

// The public gallery page is owned by public-gallery.ts under strict
// TypeScript. Re-exported so existing ui.mjs import callers (the Worker and the
// focused gallery tests) keep the exact same module path.
export { publicGallery } from "./public-gallery.ts";

export { publicPage } from "./public-piece.ts";

// The public tool, help and 404 page renderers are owned by
// public-tool-pages.ts under strict TypeScript. Re-exported so existing
// ui.mjs import callers (the Worker and the focused tests) keep the same
// module path.
export { audioTrimPage, imagesPage, videoClipPage, addMusicPage, helpPage, notFoundPage } from "./public-tool-pages.ts";

// The private review room, reviewer comparison and refusal pages are owned by
// review-pages.ts under strict TypeScript. Re-exported so existing ui.mjs
// import callers (the Worker and the focused review-room tests) keep the exact
// same module path.
export { reviewRoomPage, reviewComparePage, reviewRefusalPage } from "./review-pages.ts";

// The model chooser page is owned by compare-page.ts under strict TypeScript.
// Re-exported so existing ui.mjs import callers (the Worker route and the
// focused comparison tests) keep the exact same module path.
export { comparePage } from "./compare-page.ts";
