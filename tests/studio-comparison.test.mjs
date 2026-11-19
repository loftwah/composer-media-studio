// The private comparison link carries opaque ids only, in the fragment. The
// shell and the React library read the same typed helper, so its limits are the
// link's limits wherever the link is built or reopened.
import assert from "node:assert/strict";
import test from "node:test";
import { comparisonFromRoute, comparisonLink, resolveComparison } from "../public/studio-comparison.js";

const A = "asset_9c507145eaac4ebd9907001db1796085";
const B = "asset_53e0b83b53f541e1b3eb83c1154a90cb";
const C = "asset_13742a8111c643029350b078fd9941cf";

test("the link holds exactly two distinct opaque ids in the fragment", () => {
  assert.equal(comparisonLink("proj_1", [A, B]), `#/p/proj_1/library/compare/${A}/${B}`);
  assert.equal(comparisonLink("proj_1", [A]), null);
  assert.equal(comparisonLink("proj_1", [A, A]), null);
  assert.equal(comparisonLink("proj_1", [A, B, C]), null);
  assert.equal(comparisonLink("proj_1", [A, "asset_bad"]), null);
  assert.equal(comparisonLink("", [A, B]), null);
});

test("the route suffix parser accepts only the exact shape", () => {
  assert.deepEqual(comparisonFromRoute(["library", "compare", A, B]), [A, B]);
  assert.equal(comparisonFromRoute(["library", "compare", A, A]), null);
  assert.equal(comparisonFromRoute(["library", "compare", A]), null);
  assert.equal(comparisonFromRoute(["library", "compare", A, B, C]), null);
  assert.equal(comparisonFromRoute(["nonsense", "compare", A, B]), null);
});

test("unknown, cross-project, duplicate and mixed pairs fail closed", () => {
  const assets = [
    { id: A, kind: "video" },
    { id: B, kind: "video" },
    { id: C, kind: "image" },
    { id: "asset_4ee04be7afe743e4b136a9b6feac34ce", kind: "audio" },
  ];
  assert.deepEqual(resolveComparison(assets, [A, B]), { kind: "video", ids: [A, B] });
  assert.deepEqual(resolveComparison(assets, [C, C]), null);
  assert.equal(resolveComparison(assets, [A, "asset_00000000000000000000000000000000"]), null);
  // ids minted for a different project are simply not in this project's assets
  assert.equal(resolveComparison(assets, ["asset_11111111111111111111111111111111", "asset_22222222222222222222222222222222"]), null);
  assert.equal(resolveComparison(assets, [A, A]), null);
  assert.equal(resolveComparison(assets, [A, C]), null);
  assert.equal(resolveComparison(assets, [A, "asset_4ee04be7afe743e4b136a9b6feac34ce"]), null);
});
