// MIT. Media Studio hash routes and project-tab keyboard order.
//
// This module is deliberately DOM-free: the browser shell and node tests read
// the same rules. `parseStudioHash` never guesses a screen for a hash it does
// not know, and an unknown project section falls back to Library with the
// original segment kept for a short explanation.
import { comparisonFromRoute } from "./studio-comparison.js";

export const PROJECT_TABS = Object.freeze([
  "library",
  "create",
  "assemble",
  "history",
  "publish",
  "review",
  "settings",
]);

const isProjectTab = (value) => PROJECT_TABS.includes(value);

/**
 * @param {string} hash
 * @returns {{view: "home"} | {view: "invalid", hash: string} | {view: "project", projectId: string, tab: string, unknownTab?: string, comparisonLink?: boolean, compareIds?: string[]} | {view: "asset", projectId: string, assetId: string}}
 */
export function parseStudioHash(hash = "") {
  const clean = String(hash ?? "").replace(/^#\/?/, "").replace(/\/+$/, "");
  if (!clean) return { view: "home" };
  const parts = clean.split("/");
  const [segment, id, tab] = parts;
  if (segment === "p" && id) {
    // A private comparison link is a Library route with exactly two opaque ids
    // after it. Only the exact shape resolves; a lookalike fails closed to the
    // ordinary Library instead of becoming an unexplained error screen.
    if (tab === "library" && parts[3] === "compare") {
      const compareIds = comparisonFromRoute(parts.slice(2));
      if (compareIds) return { view: "project", projectId: id, tab: "library", comparisonLink: true, compareIds };
      return { view: "project", projectId: id, tab: "library", comparisonLink: true };
    }
    if (parts.length <= 3) {
      if (tab === undefined || tab === "") {
        return { view: "project", projectId: id, tab: "library" };
      }
      if (isProjectTab(tab)) {
        return { view: "project", projectId: id, tab };
      }
      // `#/p/:id/nonsense` is a project the user can still use. Keep the stable
      // Library screen selected and let the caller explain and replace the hash.
      return { view: "project", projectId: id, tab: "library", unknownTab: tab };
    }
  }
  if (segment === "a" && id && tab && parts.length === 3) {
    return { view: "asset", projectId: id, assetId: tab };
  }
  return { view: "invalid", hash: clean };
}

/**
 * The next tab for a horizontal tablist. Returns null for keys the tablist
 * does not own so typing and browser shortcuts keep working.
 * @param {string} current
 * @param {string} key
 * @param {readonly string[]} tabs
 */
export function nextProjectTab(current, key, tabs = PROJECT_TABS) {
  const index = tabs.indexOf(current);
  if (index < 0) return null;
  if (key === "Home") return tabs[0];
  if (key === "End") return tabs[tabs.length - 1];
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const delta = key === "ArrowRight" ? 1 : -1;
  return tabs[(index + delta + tabs.length) % tabs.length];
}
