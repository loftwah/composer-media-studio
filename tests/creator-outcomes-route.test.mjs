// MIT. Focused route checks for the private creator-outcomes read. Fictional
// fixtures only: no production D1/R2, no provider keys and no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { setup } from "./harness.mjs";

const ROUTE = (projectId) => `/api/projects/${projectId}/creator-outcomes`;

async function ownerCookie(env) {
  return `studio_session=${await createSession(env, { mode: "owner" })}`;
}

async function bridgeCookie(env, { project, actions }) {
  return `studio_session=${await createSession(env, {
    mode: "bridge",
    actor: "fictional-member",
    workspace: "ws-fictional",
    project,
    actions,
  })}`;
}

function call(env, path, { cookie, method = "GET" } = {}) {
  return worker.fetch(
    new Request(`https://studio.test${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        origin: "https://studio.test",
      },
    }),
    env,
    { waitUntil() {} },
  );
}

const METRICS = {
  saved_provider_outputs: "saved_outputs",
  saved_local_exports: "saved_exports",
  publication_published: "publication_transitions",
  publication_unlisted: "publication_transitions",
  publication_withdrawn: "publication_transitions",
};

function assertContractShape(payload, projectId) {
  assert.equal(payload.format, "media-studio.creator-outcomes/v1");
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.projectId, projectId);
  assert.equal(payload.window.timezone, "UTC");
  assert.match(payload.window.fromInclusive, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(payload.window.toExclusive, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Date.parse(payload.window.fromInclusive) < Date.parse(payload.window.toExclusive));
  assert.ok(!Number.isNaN(Date.parse(payload.generatedAt)));
  assert.equal(typeof payload.source.producer, "string");
  assert.equal(typeof payload.source.revision, "string");
  assert.ok(payload.source.watermark === null || typeof payload.source.watermark === "string");
  assert.equal(Object.keys(METRICS).length, 5);
  assert.deepEqual(new Set(payload.metrics.map((metric) => metric.key)), new Set(Object.keys(METRICS)));
  for (const metric of payload.metrics) {
    assert.equal(metric.unit, METRICS[metric.key]);
    assert.equal(typeof metric.label, "string");
    assert.ok(metric.value === null || typeof metric.value === "number");
    assert.ok(metric.status === "partial" || metric.status === "unavailable");
    assert.equal(typeof metric.definition, "string");
    assert.equal(typeof metric.evidenceLevel, "string");
    assert.equal(typeof metric.coverage, "string");
    assert.ok(metric.coverage.length > 0);
  }
}

test("creator-outcomes is an owner/admin read with no public endpoint and no auth bypass", async () => {
  const { env, project } = await setup({ projectId: "prj_outcomes_auth" });
  const path = ROUTE(project.id);

  const anonymous = await call(env, path);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error.code, "unauthorized");

  // A query string or a caller-supplied origin is not a privilege.
  const bypassed = await call(env, `${path}?admin=1&producer=https://evil.test`);
  assert.equal(bypassed.status, 401);

  const readOnly = await call(env, path, { cookie: await bridgeCookie(env, { project: project.id, actions: ["read"] }) });
  assert.equal(readOnly.status, 403);

  const wrongScope = await call(env, path, {
    cookie: await bridgeCookie(env, { project: "prj_other_scope", actions: ["read", "admin"] }),
  });
  assert.equal(wrongScope.status, 403);
  assert.equal((await wrongScope.json()).error.code, "forbidden");

  const controlOwner = await call(env, path, { cookie: await ownerCookie(env) });
  assert.equal(controlOwner.status, 200);
  assertContractShape(await controlOwner.json(), project.id);

  const scopedAdmin = await call(env, path, {
    cookie: await bridgeCookie(env, { project: project.id, actions: ["read", "admin"] }),
  });
  assert.equal(scopedAdmin.status, 200);
  assertContractShape(await scopedAdmin.json(), project.id);
});

test("creator-outcomes is private native JSON with a canonical producer origin", async () => {
  const { env, project } = await setup({ projectId: "prj_outcomes_shape" });
  await env.DB.prepare(
    "INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,sha256,title,caption,source,created_at,updated_at) VALUES('asset_private_prompt','prj_outcomes_shape','image','k-private','image/png',5,'hash-private','Fictional private still','','upload',1,1)",
  ).run();
  await env.DB.prepare(
    "INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,status,cost_estimate_micro,cost_reserved_micro,created_at,updated_at) VALUES('gen_private_prompt','prj_outcomes_shape','req-private','image','custom','fal','studio-detail',?1,'saved',0,0,1,1)",
  ).bind(JSON.stringify({ prompt: "FICTIONAL_SECRET_PROMPT_TEXT" })).run();

  const response = await call(env, ROUTE(project.id), { cookie: await ownerCookie(env) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);

  const raw = await response.text();
  assert.equal(raw.includes("FICTIONAL_SECRET_PROMPT_TEXT"), false);
  assert.equal(raw.includes("Fictional private still"), false);
  assert.equal(raw.includes("fictional-member"), false);
  const payload = JSON.parse(raw);
  assertContractShape(payload, project.id);
  // PUBLIC_ORIGIN from the harness wins over the request origin; it is never
  // taken from a caller-supplied parameter.
  assert.equal(payload.source.producer, "https://studio.test");
});

test("invalid outcome windows are 400 after auth, never a healthy zero report", async () => {
  const { env, project } = await setup({ projectId: "prj_outcomes_window" });
  const cookie = await ownerCookie(env);
  const invalid = [
    "?from=2026-13-40&until=2026-13-45",
    "?from=nonsense&until=also-nonsense",
    "?from=2026-01-01",
    "?from=2026-01-01&until=2026-01-01",
    "?from=2099-01-01&until=2099-01-08",
  ];
  for (const query of invalid) {
    const response = await call(env, ROUTE(project.id) + query, { cookie });
    assert.equal(response.status, 400, `expected 400 for ${query || "empty window"}`);
    assert.equal((await response.json()).error.code, "invalid_window");
  }

  // Authentication still comes first: a bad window cannot be used to probe the
  // route or to bypass the session gate.
  const anonymous = await call(env, ROUTE(project.id) + "?from=bad&until=bad");
  assert.equal(anonymous.status, 401);

  const valid = await call(env, ROUTE(project.id) + "?from=2026-01-01&until=2026-01-31", { cookie });
  assert.equal(valid.status, 200);
  const payload = await valid.json();
  assertContractShape(payload, project.id);
  assert.equal(payload.window.fromInclusive, "2026-01-01");
  assert.equal(payload.window.toExclusive, "2026-01-31");
});

test("source lookup failures surface as errors rather than zeroed metrics", async () => {
  const { env, project } = await setup({ projectId: "prj_outcomes_failure" });
  const cookie = await ownerCookie(env);
  const originalPrepare = env.DB.prepare.bind(env.DB);
  const sourceTables = /\b(?:assets|generations|publications|local_render_receipts|footage_export_receipts)\b/i;
  env.DB.prepare = (sql) => {
    if (sourceTables.test(sql)) throw new Error("fictional source lookup failure");
    return originalPrepare(sql);
  };
  try {
    const response = await call(env, ROUTE(project.id), { cookie });
    assert.ok(response.status >= 400, "a failed source lookup must not return 200 with zero metrics");
  } finally {
    env.DB.prepare = originalPrepare;
  }
});
