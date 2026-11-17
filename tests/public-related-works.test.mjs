// MIT. Focused eligibility tests for the related-work strip on a public work page.
import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/worker.mjs";
import { setup } from "./harness.mjs";

const base = "https://studio.test";

function get(env, path) {
  return worker.fetch(new Request(base + path), env);
}

async function addProject(env, { id, name, slug }) {
  await env.DB.prepare(
    "INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES(?1,?2,?3,'','private','{}',1,1)",
  )
    .bind(id, name, slug)
    .run();
}

/**
 * A listed publication backed by a live asset. Each option flips exactly one
 * eligibility fact so an exclusion can be attributed to a single condition.
 */
async function addWork(env, project, { id, slug, createdAt, listed = 1, hidden = 0, revoked = null, deleted = false, kind = "image" }) {
  const assetId = `asset_${id}`;
  await env.DB.prepare(
    `INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,sha256,title,caption,source,created_at,updated_at,deleted_at)
     VALUES(?1,?2,?3,?4,?5,10,1280,720,?6,?7,'','upload',?8,?8,?9)`,
  )
    .bind(assetId, project.id, kind, `key-${id}`, kind === "video" ? "video/mp4" : "image/png", `sha-${id}`, slug, createdAt, deleted ? createdAt : null)
    .run();
  await env.DB.prepare(
    `INSERT INTO publications(id,project_id,asset_id,poster_asset_id,slug,title,description,asset_revision,created_at,listed,hidden,revoked_at)
     VALUES(?1,?2,?3,NULL,?4,?5,'',1,?6,?7,?8,?9)`,
  )
    .bind(`pub_${id}`, project.id, assetId, slug, slug, createdAt, listed, hidden, revoked)
    .run();
}

function relatedSlugs(html) {
  const section = html.match(/<section class="public-related"[\s\S]*?<\/section>/)?.[0] ?? "";
  return [...section.matchAll(/<li><a class="gallery-card" href="\/p\/([^"?]+)"/g)].map((match) => decodeURIComponent(match[1]));
}

test("related works are same-project, listed, still-public, bounded and newest-first", async () => {
  const { env } = await setup();
  const alpha = { id: "prj_alpha" };
  const beta = { id: "prj_beta" };
  await addProject(env, { id: alpha.id, name: "Alpha", slug: "alpha" });
  await addProject(env, { id: beta.id, name: "Beta", slug: "beta" });

  await addWork(env, alpha, { id: "current", slug: "current", createdAt: 10 });
  await addWork(env, alpha, { id: "newest", slug: "rel-newest", createdAt: 30 });
  await addWork(env, alpha, { id: "mid", slug: "rel-mid", createdAt: 20 });
  await addWork(env, alpha, { id: "old", slug: "rel-old", createdAt: 15 });
  await addWork(env, alpha, { id: "fourth", slug: "rel-fourth", createdAt: 12 });

  // Every one of these must fail eligibility for a different reason.
  await addWork(env, alpha, { id: "unlisted", slug: "rel-unlisted", createdAt: 90, listed: 0 });
  await addWork(env, alpha, { id: "hidden", slug: "rel-hidden", createdAt: 89, hidden: 1 });
  await addWork(env, alpha, { id: "withdrawn", slug: "rel-withdrawn", createdAt: 88, revoked: 100 });
  await addWork(env, alpha, { id: "deleted", slug: "rel-deleted", createdAt: 87, deleted: true });
  await addWork(env, beta, { id: "other", slug: "beta-work", createdAt: 99 });

  const response = await get(env, "/p/current");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.deepEqual(relatedSlugs(html), ["rel-newest", "rel-mid", "rel-old"]);
  // Self is excluded from the strip (it still appears as this page's own canonical).
  const section = html.match(/<section class="public-related"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.doesNotMatch(section, /\/p\/current(?:"|[?])/);
  for (const excluded of ["rel-fourth", "rel-unlisted", "rel-hidden", "rel-withdrawn", "rel-deleted", "beta-work", "Beta"]) {
    assert.doesNotMatch(html, new RegExp(`/p/${excluded}(?:"|[?])`), `must not link ${excluded}`);
  }
});

test("unlisted work does not expose its relationship to the project gallery", async () => {
  const { env } = await setup();
  const project = { id: "prj_alpha" };
  await addProject(env, { id: project.id, name: "Alpha", slug: "alpha" });
  await addWork(env, project, { id: "unlisted", slug: "unlisted", createdAt: 10, listed: 0 });
  await addWork(env, project, { id: "listed", slug: "listed", createdAt: 20 });
  const response = await get(env, "/p/unlisted");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /name="robots" content="noindex"/);
  assert.deepEqual(relatedSlugs(html), []);
});

test("equal timestamps break ties by id, so ordering stays deterministic", async () => {
  const { env } = await setup();
  const alpha = { id: "prj_alpha" };
  await addProject(env, { id: alpha.id, name: "Alpha", slug: "alpha" });
  await addWork(env, alpha, { id: "current", slug: "current", createdAt: 10 });
  // Same created_at: publication ids pub_tie_a < pub_tie_b, so b comes first.
  await addWork(env, alpha, { id: "tie_a", slug: "tie-a", createdAt: 20 });
  await addWork(env, alpha, { id: "tie_b", slug: "tie-b", createdAt: 20 });
  const html = await (await get(env, "/p/current")).text();
  assert.deepEqual(relatedSlugs(html), ["tie-b", "tie-a"]);
});

test("no eligible related work omits the section, and related links stay canonical", async () => {
  const { env } = await setup();
  const alpha = { id: "prj_alpha" };
  const beta = { id: "prj_beta" };
  await addProject(env, { id: alpha.id, name: "Alpha", slug: "alpha" });
  await addProject(env, { id: beta.id, name: "Beta", slug: "beta" });
  await addWork(env, alpha, { id: "current", slug: "current", createdAt: 10 });
  await addWork(env, beta, { id: "other", slug: "beta-work", createdAt: 99 });

  const alone = await (await get(env, "/p/current")).text();
  assert.doesNotMatch(alone, /public-related|More from this project|gallery-card/);

  await addWork(env, alpha, { id: "second", slug: "second-work", createdAt: 20 });
  const withRelated = await (await get(env, "/p/current?back=%2Fgallery%3Fproject%3Dalpha%26page%3D2")).text();
  assert.deepEqual(relatedSlugs(withRelated), ["second-work"]);
  // The related card uses the exact canonical public link, with no back param.
  assert.match(withRelated, /<section class="public-related"[\s\S]*?href="\/p\/second-work"/);
  assert.doesNotMatch((withRelated.match(/<section class="public-related"[\s\S]*?<\/section>/) ?? [""])[0], /back=/);
  // Existing back/filter and canonical copy behaviour is untouched.
  assert.match(withRelated, /href="https:\/\/studio\.test\/gallery\?project=alpha&amp;page=2"/);
  assert.match(withRelated, /data-copy-url="https:\/\/studio\.test\/p\/current"/);
});
