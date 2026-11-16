import { test } from "node:test";
import assert from "node:assert/strict";

import { imagesPage, loginPage } from "../src/lib/ui.mjs";

test("the public image page mounts the tracked wrapper with the build revision", () => {
  const html = imagesPage({ revision: "abc123" });
  assert.match(html, /<title>Image tools — Media Studio<\/title>/);
  assert.match(html, /<div id="images">/);
  assert.match(html, /src="\/images\.js\?v=abc123"/);
  assert.match(html, /JavaScript is required/);
});

test("login discovery links to the signed-out image workbench", () => {
  assert.match(loginPage({ revision: "abc123" }), /href="\/tools\/images"/);
});
