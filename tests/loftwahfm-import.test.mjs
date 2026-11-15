import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { setup } from "./harness.mjs";

const source = "https://fm.loftwah.com/media/refined/After%20Hours.mp3";
const mp3 = new Uint8Array(417 * 100);
for (let index = 0; index < mp3.length; index += 417) mp3.set([0xff, 0xfb, 0x90, 0], index);

test("LoftwahFM import is private, measured, deduplicated and scoped to a permitted source", async t => {
  const { env, project } = await setup();
  const cookie = "studio_session=" + await createSession(env);
  const request = (input, auth = cookie) => worker.fetch(new Request(
    `https://studio.test/api/projects/${project.id}/assets/loftwahfm`,
    { method: "POST", headers: { cookie: auth, "content-type": "application/json" }, body: JSON.stringify(input) },
  ), env);
  let redirected = false;
  const upstream = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, source);
    assert.equal(options.redirect, "manual");
    if (redirected) return new Response(null, { status: 302, headers: { location: "https://outside.test/track.mp3" } });
    return new Response(mp3, { headers: { "content-type": "audio/mpeg" } });
  });

  assert.equal((await request({ url: source, rightsConfirmed: true }, "")).status, 401);
  assert.equal((await request({ url: source })).status, 400);
  for (const url of [
    "https://other.test/media/refined/After%20Hours.mp3",
    "https://fm.loftwah.com/media/refined/some%2fAfter%20Hours.mp3",
    source + "?redirect=http://elsewhere.test",
    "https://fm.loftwah.com/api/catalog",
  ]) assert.equal((await request({ url, rightsConfirmed: true })).status, 400);
  assert.equal(upstream.mock.callCount(), 0);

  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    const statement = prepare(sql);
    if (sql.includes("INSERT INTO assets")) {
      const bind = statement.bind;
      statement.bind = (...args) => {
        const bound = bind(...args);
        const run = bound.run;
        bound.run = async () => {
          await run();
          throw new Error("The D1 insert committed, then lost its reply");
        };
        return bound;
      };
    }
    return statement;
  };
  redirected = true;
  assert.equal((await request({ url: source, rightsConfirmed: true })).status, 502);
  assert.equal(upstream.mock.callCount(), 1);
  redirected = false;
  const imported = await request({ url: source, rightsConfirmed: true });
  assert.equal(imported.status, 201, imported.status === 201 ? "" : await imported.text());
  const { asset } = await imported.json();
  assert.equal(asset.title, "After Hours");
  assert.equal(asset.kind, "audio");
  assert.equal(asset.caption, source);
  assert.ok(asset.durationMs >= 2000);
  const stored = await env.DB.prepare("SELECT r2_key FROM assets WHERE id=?1").bind(asset.id).first();
  assert.ok(await env.MEDIA.head(stored.r2_key));

  const repeated = await request({ url: source, rightsConfirmed: true });
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).asset.id, asset.id);
  const publicCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM publications").first();
  assert.equal(publicCount.count, 0);
  assert.equal((await worker.fetch(new Request(`https://studio.test/api/assets/${asset.id}/file`), env)).status, 401);
});
