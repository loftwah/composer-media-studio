// Generated from src/browser/studio-login-return.ts; edit that source.
// MIT. Resume a private Studio URL in the same tab after the existing sign-in.
// Authored here; public/studio-login-return.js is emitted by scripts/launcher-assets.mjs.
import { parseStudioHash } from "./studio-route.js";
const KEY = "media-studio:sign-in-return:v1";
const MAX_AGE_MS = 15 * 60 * 1000;
const PROJECT_ID = /^prj_[0-9a-f]{32}$/;
const ASSET_ID = /^asset_[0-9a-f]{32}$/;
export function normalizeStudioSignInRoute(hash) {
    if (typeof hash !== "string" || !hash.startsWith("#/") || hash.length > 180)
        return "";
    const route = parseStudioHash(hash);
    const projectId = "projectId" in route ? route.projectId : "";
    if (!PROJECT_ID.test(projectId))
        return "";
    if (route.view === "asset" && ASSET_ID.test(route.assetId))
        return `#/a/${route.projectId}/${route.assetId}`;
    if (route.view !== "project" || route.unknownTab)
        return "";
    const base = `#/p/${route.projectId}/${route.tab}`;
    if (route.comparisonLink)
        return route.compareIds ? `${base}/compare/${route.compareIds.join("/")}` : "";
    return base;
}
export function rememberStudioSignInRoute(hash, storage, now = Date.now()) {
    try {
        storage ??= globalThis.sessionStorage;
        const route = normalizeStudioSignInRoute(hash);
        if (route)
            storage.setItem(KEY, JSON.stringify({ route, savedAt: now }));
        else
            storage.removeItem(KEY);
    }
    catch {
        // Signing in still works when browser storage is disabled.
    }
}
export function consumeStudioSignInRoute(currentHash, storage, now = Date.now()) {
    try {
        storage ??= globalThis.sessionStorage;
        const saved = storage.getItem(KEY);
        storage.removeItem(KEY);
        if (currentHash || !saved || saved.length > 240)
            return "";
        const { route, savedAt } = JSON.parse(saved);
        if (typeof savedAt !== "number" || !Number.isSafeInteger(savedAt) || savedAt > now || now - savedAt >= MAX_AGE_MS)
            return "";
        return normalizeStudioSignInRoute(route);
    }
    catch {
        return "";
    }
}
