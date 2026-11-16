// The browser shell and these tests read the same DOM-free route module.
import assert from "node:assert/strict";
import test from "node:test";
import { PROJECT_TABS, nextProjectTab, parseStudioHash } from "../public/studio-route.js";

test("empty and root hashes are the studio home", () => {
  assert.deepEqual(parseStudioHash(""), { view: "home" });
  assert.deepEqual(parseStudioHash("#"), { view: "home" });
  assert.deepEqual(parseStudioHash("#/"), { view: "home" });
});

test("project and asset routes keep their valid identifiers", () => {
  assert.deepEqual(parseStudioHash("#/p/proj_1"), { view: "project", projectId: "proj_1", tab: "library" });
  assert.deepEqual(parseStudioHash("#/p/proj_1/create"), { view: "project", projectId: "proj_1", tab: "create" });
  assert.deepEqual(parseStudioHash("#/a/proj_1/asset_2"), { view: "asset", projectId: "proj_1", assetId: "asset_2" });
});

test("an unknown project tab selects Library and remembers the bad segment", () => {
  assert.deepEqual(parseStudioHash("#/p/proj_1/nonsense"), {
    view: "project",
    projectId: "proj_1",
    tab: "library",
    unknownTab: "nonsense",
  });
  // The fallback tab is always one of the real, usable sections.
  assert.ok(PROJECT_TABS.includes(parseStudioHash("#/p/proj_1/nonsense").tab));
});

test("structurally malformed hashes stay invalid instead of guessing a screen", () => {
  assert.deepEqual(parseStudioHash("#/a/only-one-segment"), { view: "invalid", hash: "a/only-one-segment" });
  assert.deepEqual(parseStudioHash("#/p/proj_1/library/extra"), { view: "invalid", hash: "p/proj_1/library/extra" });
  assert.deepEqual(parseStudioHash("#/not-a-studio-route"), { view: "invalid", hash: "not-a-studio-route" });
});

test("ArrowLeft and ArrowRight wrap while Home and End jump", () => {
  assert.equal(nextProjectTab("library", "ArrowRight"), "create");
  assert.equal(nextProjectTab("settings", "ArrowRight"), "library");
  assert.equal(nextProjectTab("library", "ArrowLeft"), "settings");
  assert.equal(nextProjectTab("settings", "ArrowLeft"), "review");
  assert.equal(nextProjectTab("history", "Home"), "library");
  assert.equal(nextProjectTab("history", "End"), "settings");
  assert.equal(nextProjectTab("history", "Tab"), null);
  assert.equal(nextProjectTab("history", "a"), null);
  assert.equal(nextProjectTab("not-a-tab", "ArrowRight"), null);
});
