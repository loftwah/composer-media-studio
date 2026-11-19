import test from "node:test";
import assert from "node:assert/strict";
import {
  consumeStudioSignInRoute,
  normalizeStudioSignInRoute,
  rememberStudioSignInRoute,
} from "../public/studio-login-return.js";

const project = "prj_" + "1".repeat(32);
const first = "asset_" + "2".repeat(32);
const second = "asset_" + "3".repeat(32);
const library = `#/p/${project}/library`;
const pair = `${library}/compare/${first}/${second}`;
const now = 1000000;

function storage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("normalizes only supported private Studio project, asset and comparison routes", () => {
  assert.equal(normalizeStudioSignInRoute(`#/p/${project}`), library);
  assert.equal(normalizeStudioSignInRoute(`#/p/${project}/assemble`), `#/p/${project}/assemble`);
  assert.equal(normalizeStudioSignInRoute(`#/a/${project}/${first}`), `#/a/${project}/${first}`);
  assert.equal(normalizeStudioSignInRoute(pair), pair);
  for (const input of [
    "",
    "https://example.com/",
    "#//somewhere",
    "#/p/unknown/library",
    `#/p/${project}/unknown`,
    `#/a/${project}/${first}/extra`,
    `${library}/compare/${first}/${first}`,
    `${pair}/extra`,
  ]) assert.equal(normalizeStudioSignInRoute(input), "", input);
});

test("remembers one ordered route only in the current storage and consumes it once", () => {
  const sameTab = storage();
  rememberStudioSignInRoute(pair, sameTab, now);
  assert.equal(consumeStudioSignInRoute("", storage(), now + 1), "");
  assert.equal(consumeStudioSignInRoute("", sameTab, now + 1), pair);
  assert.equal(consumeStudioSignInRoute("", sameTab, now + 2), "");
});

test("an explicit route wins, invalid input clears pending state, and expired state is discarded", () => {
  const sameTab = storage();
  rememberStudioSignInRoute(pair, sameTab, now);
  assert.equal(consumeStudioSignInRoute(library, sameTab, now + 1), "");
  assert.equal(sameTab.values.size, 0);

  rememberStudioSignInRoute(pair, sameTab, now);
  rememberStudioSignInRoute("", sameTab, now);
  assert.equal(consumeStudioSignInRoute("", sameTab, now), "");

  rememberStudioSignInRoute(pair, sameTab, now);
  assert.equal(consumeStudioSignInRoute("", sameTab, now + 15 * 60 * 1000), "");
  assert.equal(sameTab.values.size, 0);
});

test("broken browser storage and corrupted stored data do not affect sign-in", () => {
  const sameTab = storage();
  rememberStudioSignInRoute(library, sameTab, now);
  const [key] = sameTab.values.keys();
  sameTab.values.set(key, "not JSON");
  assert.equal(consumeStudioSignInRoute("", sameTab, now), "");
  assert.equal(sameTab.values.size, 0);

  const blocked = {
    setItem: () => { throw new Error("storage disabled"); },
    getItem: () => { throw new Error("storage disabled"); },
  };
  assert.doesNotThrow(() => rememberStudioSignInRoute(library, blocked, now));
  assert.equal(consumeStudioSignInRoute("", blocked, now), "");
});
