// MIT. Owner bulk visibility changes and their audit trail.
import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { setup, addAsset } from "./harness.mjs";

const base = "https://studio.test";

function request(env, path, { cookie, method = "GET", data } = {}) {
  return worker.fetch(
    new Request(base + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(data ? { "content-type": "application/json", origin: base } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    }),
    env,
  );
}

async function publication(env, project, { id, assetId, slug, listed = 0, hidden = 0, revoked = null }) {
  await env.DB.prepare(
    "INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,listed,hidden,revoked_at) VALUES(?1,?2,?3,?4,?5,'',1,1,?6,?7,?8)",
  )
    .bind(id, project.id, assetId, slug, `Page ${id}`, listed, hidden, revoked)
    .run();
}

test("bulk publish, unlist and withdraw report each item and append audit rows", async () => {
  const { env, project } = await setup();
  const cookie = "studio_session=" + (await createSession(env));
  const unlisted = await addAsset(env, project, { id: "asset_unlisted", kind: "image", source: "upload" });
  const listed = await addAsset(env, project, { id: "asset_listed", kind: "image", source: "upload" });
  const withdrawn = await addAsset(env, project, { id: "asset_withdrawn", kind: "image", source: "upload" });
  await publication(env, project, { id: "pub_unlisted", assetId: unlisted.id, slug: "page-unlisted" });
  await publication(env, project, { id: "pub_listed", assetId: listed.id, slug: "page-listed", listed: 1 });
  await publication(env, project, { id: "pub_withdrawn", assetId: withdrawn.id, slug: "page-withdrawn", listed: 1, revoked: 1 });
  const path = `/api/projects/${project.id}/publications/bulk`;
  const ids = ["pub_unlisted", "pub_listed", "pub_withdrawn", "pub_missing"];

  const published = await request(env, path, {
    cookie,
    method: "POST",
    data: { action: "publish", publicationIds: ids, confirm: true },
  });
  assert.equal(published.status, 200);
  const publish = await published.json();
  assert.deepEqual(
    publish.results.map((item) => [item.publicationId, item.result]),
    [
      ["pub_unlisted", "published"],
      ["pub_listed", "unchanged"],
      ["pub_withdrawn", "withdrawn"],
      ["pub_missing", "not_found"],
    ],
  );
  assert.equal(publish.changed, 1);
  assert.equal(publish.unchanged, 1);
  assert.equal(publish.blocked, 2);
  assert.deepEqual(publish.results[0].previous, { listed: false, hidden: false, withdrawn: false });
  assert.deepEqual(publish.results[0].resulting, { listed: true, hidden: false, withdrawn: false });

  const afterPublish = await env.DB.prepare(
    "SELECT listed,hidden,revoked_at FROM publications WHERE id='pub_unlisted'",
  ).first();
  assert.deepEqual({ ...afterPublish }, { listed: 1, hidden: 0, revoked_at: null });

  const audit = await env.DB.prepare(
    "SELECT actor,actor_name,session_mode,action,previous_state,resulting_state,created_at FROM publication_audit WHERE publication_id='pub_unlisted'",
  ).first();
  assert.equal(audit.actor, "owner");
  assert.equal(audit.session_mode, "owner");
  assert.equal(audit.action, "publish");
  assert.deepEqual(JSON.parse(audit.previous_state), { listed: false, hidden: false, withdrawn: false });
  assert.deepEqual(JSON.parse(audit.resulting_state), { listed: true, hidden: false, withdrawn: false });
  assert.ok(audit.created_at > 0);

  const unlistedResult = await (
    await request(env, path, {
      cookie,
      method: "POST",
      data: { action: "unlist", publicationIds: ["pub_unlisted", "pub_listed"], confirm: true },
    })
  ).json();
  assert.deepEqual(
    unlistedResult.results.map((item) => item.result),
    ["unlisted", "unlisted"],
  );
  assert.equal(unlistedResult.changed, 2);
  assert.equal(
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM publication_audit WHERE action='unlist'").first()).n,
    2,
  );

  const withdrawnResult = await (
    await request(env, path, {
      cookie,
      method: "POST",
      data: { action: "withdraw", publicationIds: ["pub_listed", "pub_withdrawn"], confirm: true },
    })
  ).json();
  assert.deepEqual(
    withdrawnResult.results.map((item) => item.result),
    ["withdrawn", "already_withdrawn"],
  );
  assert.equal(withdrawnResult.changed, 1);
  assert.equal(withdrawnResult.unchanged, 1);
  assert.equal(
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM publication_audit WHERE action='withdraw'").first()).n,
    1,
  );
  assert.equal(await (await request(env, "/p/page-listed")).status, 404);
});

test("bulk changes need the publish grant, the same origin and this project", async () => {
  const { env, project } = await setup({ projectId: "prj_one" });
  await env.DB.prepare(
    "INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES('prj_two','Other','other','','private','{}',1,1)",
  ).run();
  const asset = await addAsset(env, project, { id: "asset_owned", kind: "image", source: "upload" });
  await publication(env, project, { id: "pub_owned", assetId: asset.id, slug: "page-owned" });
  const path = `/api/projects/${project.id}/publications/bulk`;
  const payload = { action: "publish", publicationIds: ["pub_owned"], confirm: true };

  assert.equal((await request(env, path, { method: "POST", data: payload })).status, 401);

  const readOnly = "studio_session=" + (await createSession(env, { mode: "bridge", actor: "acct", workspace: "ws", project: project.id, actions: ["read"] }));
  assert.equal((await request(env, path, { cookie: readOnly, method: "POST", data: payload })).status, 403);

  const publisher = "studio_session=" + (await createSession(env, { mode: "bridge", actor: "acct", workspace: "ws", project: project.id, actions: ["read", "publish"] }));
  assert.equal((await request(env, path, { cookie: publisher, method: "POST", data: payload })).status, 200);
  assert.equal(
    (await env.DB.prepare("SELECT actor,session_mode FROM publication_audit WHERE publication_id='pub_owned'").first()).session_mode,
    "bridge",
  );

  const other = "studio_session=" + (await createSession(env, { mode: "bridge", actor: "acct", workspace: "ws", project: "prj_two", actions: ["read", "publish"] }));
  assert.equal((await request(env, path, { cookie: other, method: "POST", data: payload })).status, 403);

  const noConfirm = await request(env, path, { cookie: publisher, method: "POST", data: { ...payload, confirm: false } });
  assert.equal(noConfirm.status, 400);
  const crossOrigin = await worker.fetch(
    new Request(base + path, {
      method: "POST",
      headers: { cookie: publisher, "content-type": "application/json", origin: "https://evil.test" },
      body: JSON.stringify(payload),
    }),
    env,
  );
  assert.equal(crossOrigin.status, 403);
});

test("the project audit view is bounded and only returns this project's rows", async () => {
  const { env, project } = await setup();
  const cookie = "studio_session=" + (await createSession(env));
  const asset = await addAsset(env, project, { id: "asset_audit", kind: "image", source: "upload" });
  await publication(env, project, { id: "pub_audit", assetId: asset.id, slug: "page-audit" });
  await request(env, `/api/projects/${project.id}/publications/bulk`, {
    cookie,
    method: "POST",
    data: { action: "publish", publicationIds: ["pub_audit"], confirm: true },
  });
  const view = await (await request(env, `/api/projects/${project.id}/publication-audit?limit=5`, { cookie })).json();
  assert.equal(view.items.length, 1);
  assert.equal(view.items[0].publicationId, "pub_audit");
  assert.equal(view.items[0].action, "publish");
  assert.deepEqual(view.items[0].previousState, { listed: false, hidden: false, withdrawn: false });
  assert.deepEqual(view.items[0].resultingState, { listed: true, hidden: false, withdrawn: false });
});
