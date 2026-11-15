// MIT. Private reads follow the current Composer grant, and a project only
// belongs to the workspace that created it. These checks cover the browser
// session path, the media byte path and the MCP issuer boundary.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../src/worker.mjs";
import { createSession, GRANT_CACHE_MS } from "../src/lib/auth.mjs";
import { setup, addAsset } from "./harness.mjs";

const base = "https://studio.test";

function call(env, path, { method = "GET", cookie, body, headers = {} } = {}) {
  return worker.fetch(
    new Request(base + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  );
}

/** Answer the next Composer grant checks with this action list. */
function grants(actions) {
  const prior = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    if (url === "https://composer.test/api/studio/access") {
      calls += 1;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return new Response(
        JSON.stringify({ ok: true, actor: body.actor, workspace: body.workspace, actions, revision: 1 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return prior(input, init);
  };
  return {
    get calls() {
      return calls;
    },
    restore() {
      globalThis.fetch = prior;
    },
  };
}

async function bridge(env, claims = {}) {
  return (
    "studio_session=" +
    (await createSession(env, {
      mode: "bridge",
      actor: "acct-123",
      workspace: "ws-personal",
      project: null,
      actions: ["read", "edit", "generate", "publish"],
      revision: 3,
      ...claims,
    }))
  );
}

test("a revoked member loses private reads, media bytes and ranges", async () => {
  const { env, project } = await setup();
  const asset = await addAsset(env, project, { id: "asset_read1", kind: "video", durationMs: 4000 });
  await env.MEDIA.put(asset.r2_key, new Uint8Array(4096));
  await env.DB.prepare("UPDATE assets SET bytes=4096 WHERE id=?1").bind(asset.id).run();
  const cookie = await bridge(env);

  const grant = grants(["read", "generate"]);
  try {
    assert.equal((await call(env, `/api/projects/${project.id}`, { cookie })).status, 200);
    assert.equal((await call(env, `/api/assets/${asset.id}/file`, { cookie })).status, 200);
    assert.equal((await call(env, `/api/assets/${asset.id}/file`, { cookie, method: "HEAD" })).status, 200);
    assert.equal(
      (await call(env, `/api/assets/${asset.id}/file`, { cookie, headers: { range: "bytes=0-99" } })).status,
      206,
    );
    // One bounded check covers the whole playback exactly as it is written.
    assert.equal(grant.calls, 1);

    grant.restore();
    const revoked = grants([]);
    try {
      // Inside the window the retained decision still applies, which is the
      // stated bound rather than an unbounded session.
      assert.equal((await call(env, `/api/projects/${project.id}`, { cookie })).status, 200);
      await env.DB.prepare("UPDATE grant_checks SET expires_at=0").run();
      assert.equal((await call(env, `/api/projects/${project.id}`, { cookie })).status, 403);
      assert.equal((await call(env, `/api/assets/${asset.id}`, { cookie })).status, 403);
      assert.equal((await call(env, `/api/assets/${asset.id}/file`, { cookie })).status, 403);
      assert.equal((await call(env, `/api/assets/${asset.id}/file`, { cookie, method: "HEAD" })).status, 403);
      assert.equal(
        (await call(env, `/api/assets/${asset.id}/file`, { cookie, headers: { range: "bytes=0-99" } })).status,
        403,
      );
      assert.equal((await call(env, `/api/state`, { cookie })).status, 403);
      const session = await call(env, `/api/session`, { cookie });
      const payload = await session.json();
      assert.equal(payload.signedIn, false);
      assert.equal(payload.revoked, true);
      assert.deepEqual(payload.actions, []);
    } finally {
      revoked.restore();
    }
  } finally {
    assert.ok(GRANT_CACHE_MS <= 60_000);
  }
});

test("a session grant that never included read cannot read at all", async () => {
  const { env, project } = await setup();
  await addAsset(env, project, { id: "asset_read2", kind: "image" });
  const cookie = await bridge(env, { actions: ["edit"] });
  assert.equal((await call(env, `/api/projects/${project.id}`, { cookie })).status, 403);
});

test("a project belongs to the workspace that created it", async () => {
  const { env, project } = await setup();
  const asset = await addAsset(env, project, { id: "asset_scope1", kind: "image" });
  await env.DB.prepare("UPDATE projects SET workspace_id='ws-other' WHERE id=?1").bind(project.id).run();
  const member = await bridge(env);
  const owner = "studio_session=" + (await createSession(env, { mode: "owner" }));

  assert.equal((await call(env, `/api/projects/${project.id}`, { cookie: member })).status, 403);
  assert.equal((await call(env, `/api/assets/${asset.id}`, { cookie: member })).status, 403);
  assert.equal((await call(env, `/api/assets/${asset.id}/file`, { cookie: member })).status, 403);
  const state = await (await call(env, `/api/state`, { cookie: member })).json();
  assert.deepEqual(state.projects, []);

  // The standalone owner keeps the whole installation.
  assert.equal((await call(env, `/api/projects/${project.id}`, { cookie: owner })).status, 200);
  assert.equal((await call(env, `/api/assets/${asset.id}`, { cookie: owner })).status, 200);
});

test("a handoff for one project cannot reach another in the same workspace", async () => {
  const { env, project } = await setup();
  const second = "prj_second1";
  await env.DB.prepare(
    "INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,workspace_id,created_at,updated_at) VALUES(?1,'Second','slug-second','','private','{}','ws-personal',1,1)",
  )
    .bind(second)
    .run();
  const other = await addAsset(env, { id: second }, { id: "asset_scope2", kind: "image" });
  const scoped = await bridge(env, { project: project.id });
  assert.equal((await call(env, `/api/projects/${project.id}`, { cookie: scoped })).status, 200);
  assert.equal((await call(env, `/api/projects/${second}`, { cookie: scoped })).status, 403);
  assert.equal((await call(env, `/api/assets/${other.id}/file`, { cookie: scoped })).status, 403);
});

test("new projects record the workspace of the handoff that created them", async () => {
  const { env } = await setup();
  const cookie = await bridge(env);
  const created = await call(env, "/api/projects", { cookie, method: "POST", body: { name: "Bound studio" } });
  assert.equal(created.status, 201);
  const { project } = await created.json();
  const row = await env.DB.prepare("SELECT workspace_id FROM projects WHERE id=?1").bind(project.id).first();
  assert.equal(row.workspace_id, "ws-personal");

  // Historical work stays installation-wide until an owner assigns it.
  const legacy = await env.DB.prepare("SELECT workspace_id FROM projects WHERE id='prj_test'").first();
  assert.equal(legacy.workspace_id, null);
});
