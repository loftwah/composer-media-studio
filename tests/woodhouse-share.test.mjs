import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { sha256Hex } from "../src/lib/util.mjs";
import { PNG_1x1, setup } from "./harness.mjs";

test("Share browsing and imports preserve source boundaries and deduplicate concurrent saves", async (t) => {
  const { env, project } = await setup();
  env.WOODHOUSE_SHARE = "true";
  const origin = "https://woodhouse.loftwah.com";
  const hash = await sha256Hex(PNG_1x1);
  const asset = {
    id: "first-print",
    title: "Workshop <print>",
    project: "app-composer",
    visibility: "public",
    thumbnailUrl: origin + "/campaign/preview.webp",
    sourceUrl: origin + "/campaign/source.txt",
    credit: "Woodhouse · first-party art",
    original: { url: origin + "/campaign/source.png", sha256: hash },
  };
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push(String(url));
    assert.equal(options.redirect, "error");
    if (String(url) === asset.original.url) return new Response(PNG_1x1);
    if (String(url).endsWith("/first-print")) return Response.json({ version: 1, asset });
    return Response.json({ version: 1, assets: [asset], nextAfter: "second-print" });
  });
  const gallery = await worker.fetch(new Request("https://studio.test/portfolio?project=app-composer"), env);
  assert.equal(gallery.status, 200);
  assert.match(gallery.headers.get("content-security-policy"), /img-src [^;]*woodhouse\.loftwah\.com/);
  const html = await gallery.text();
  assert.match(html, /Workshop &lt;print&gt;/);
  assert.match(html, /project=app-composer&amp;after=second-print/);
  assert.doesNotMatch(html, /<print>/);

  const cookie = "studio_session=" + await createSession(env);
  const path = `https://studio.test/api/projects/${project.id}/assets/woodhouse`;
  const submit = (data, authenticated = true) => worker.fetch(new Request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(authenticated ? { cookie } : {}) },
    body: JSON.stringify(data),
  }), env);
  assert.equal((await submit({ assetId: asset.id, reuseConfirmed: true }, false)).status, 401);
  assert.equal((await submit({ assetId: asset.id })).status, 400);
  assert.equal(requests.length, 1);

  const payload = { assetId: asset.id, reuseConfirmed: true };
  const results = await Promise.all([submit(payload), submit(payload)]);
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 201]);
  const saved = await Promise.all(results.map((response) => response.json()));
  assert.equal(saved[0].asset.id, saved[1].asset.id);
  assert.equal(saved[0].asset.source, "upload");
  assert.equal(saved[0].asset.sha256, hash);
  assert.match(saved[0].asset.caption, /first-print\n.*source\.txt\nWoodhouse/);
  assert.equal(env.MEDIA.objects.size, 1);

  asset.original.url = "https://other.example/source.png";
  assert.equal((await submit(payload)).status, 422);
  assert.ok(requests.every((url) => url.startsWith(origin + "/")));
});
