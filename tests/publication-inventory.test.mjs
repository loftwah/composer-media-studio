// MIT. The read-only publication inventory, its bounded backfill and the
// explicit auto-publication decision point.
import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { inventory, policyFor, publishCandidate } from "../src/lib/publication-policy.mjs";
import { PNG_1x1, setup, addAsset } from "./harness.mjs";
import { sha256Hex } from "../src/lib/util.mjs";

const base = "https://studio.test";

async function generated(env, project, { id, sha, created = 1, source = "generated", model = "studio-print", request = {} }) {
  const asset = await addAsset(env, project, { id, kind: "image", source });
  await env.DB.prepare(
    "INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,status,output_asset_id,cost_estimate_micro,cost_reserved_micro,created_at,updated_at) VALUES(?1,?2,?3,'image','recipe','test',?4,?5,'saved',?6,0,0,?7,?7)",
  )
    .bind(`gen_${id}`, project.id, `req_${id}`, model, JSON.stringify({ prompt: "PRIVATE PROMPT", referenceAssetId: null, parentAssetId: null, maskAssetId: null, ...request }), asset.id, created)
    .run();
  await env.DB.prepare("UPDATE assets SET generation_id=?2,sha256=?3 WHERE id=?1").bind(asset.id, `gen_${id}`, sha).run();
  return env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(asset.id).first();
}

async function putBytes(env, asset) {
  await env.MEDIA.put(asset.r2_key, PNG_1x1);
  await env.DB.prepare("UPDATE assets SET mime='image/png',bytes=?2,sha256=?3 WHERE id=?1")
    .bind(asset.id, PNG_1x1.byteLength, await sha256Hex(PNG_1x1))
    .run();
  return env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(asset.id).first();
}

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

test("the dry run reports eligible outputs, duplicates, private references and excluded reasons", async () => {
  const { env, project } = await setup();
  const cookie = "studio_session=" + (await createSession(env));
  const candidate = await putBytes(env, await generated(env, project, { id: "asset_candidate", sha: "sha-candidate" }));
  const noBytes = await generated(env, project, { id: "asset_candidate_nobytes", sha: "sha-nobytes" });
  const existing = await generated(env, project, { id: "asset_existing", sha: "sha-existing" });
  const upload = await addAsset(env, project, { id: "asset_upload", kind: "image", source: "upload" });
  await env.DB.prepare("UPDATE assets SET sha256='sha-upload' WHERE id=?1").bind(upload.id).run();
  const reference = await addAsset(env, project, { id: "asset_reference", kind: "image", source: "upload" });
  await env.DB.prepare("UPDATE assets SET sha256='sha-reference' WHERE id=?1").bind(reference.id).run();
  const child = await generated(env, project, {
    id: "asset_child",
    sha: "sha-child",
    model: "studio-detail",
    source: "variant",
    request: { referenceAssetId: reference.id, referenceSha256: "sha-reference" },
  });
  await env.DB.prepare("UPDATE assets SET parent_asset_id=?2 WHERE id=?1").bind(child.id, reference.id).run();
  const deleted = await generated(env, project, { id: "asset_deleted", sha: "sha-deleted" });
  await env.DB.prepare("UPDATE assets SET deleted_at=2 WHERE id=?1").bind(deleted.id).run();
  const duplicateA = await generated(env, project, { id: "asset_duplicate_a", sha: "sha-duplicate" });
  const duplicateB = await generated(env, project, { id: "asset_duplicate_b", sha: "sha-duplicate" });
  await env.MEDIA.put(duplicateB.r2_key, PNG_1x1);
  for (const asset of [existing, upload, reference, child, duplicateA]) await env.MEDIA.put(asset.r2_key, PNG_1x1);
  await env.DB.prepare(
    "INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,listed) VALUES('pub_existing',?1,?2,'page-existing','Existing','',1,1,1)",
  )
    .bind(project.id, existing.id)
    .run();
  await env.DB.prepare(
    "INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,listed) VALUES('pub_duplicate',?1,?2,'page-duplicate','Duplicate','',1,1,1)",
  )
    .bind(project.id, duplicateA.id)
    .run();

  assert.equal((await request(env, `/api/projects/${project.id}/publication-inventory`)).status, 401);
  const response = await request(env, `/api/projects/${project.id}/publication-inventory`, { cookie });
  assert.equal(response.status, 200);
  const view = await response.json();
  const byId = Object.fromEntries(view.items.map((item) => [item.id, item]));

  assert.equal(byId.asset_candidate.status, "candidate");
  assert.equal(byId.asset_candidate.eligible, true);
  assert.equal(byId.asset_candidate.excludedReason, null);
  assert.equal(byId.asset_candidate.storageMissing, false);

  assert.equal(byId.asset_candidate_nobytes.status, "candidate");
  assert.equal(byId.asset_candidate_nobytes.eligible, false);
  assert.equal(byId.asset_candidate_nobytes.excludedReason, "output_bytes_missing");

  assert.equal(byId.asset_existing.status, "existing");
  assert.equal(byId.asset_upload.excludedReason, "private_upload");
  assert.equal(byId.asset_reference.excludedReason, "reference_original");
  assert.equal(byId.asset_child.excludedReason, "attribution_review_required");
  assert.equal(byId.asset_deleted.excludedReason, "asset_deleted");
  assert.equal(byId.asset_duplicate_a.duplicate, true);
  assert.equal(byId.asset_duplicate_b.duplicate, true);
  assert.equal(byId.asset_duplicate_b.eligible, false);
  assert.equal(byId.asset_duplicate_b.excludedReason, "duplicate_of_published");
  assert.equal(byId.asset_duplicate_b.duplicateOfPublished, "page-duplicate");

  assert.equal(view.summary.totalAssets, 9);
  assert.equal(view.summary.activeAssets, 8);
  assert.equal(view.summary.deletedAssets, 1);
  assert.equal(view.summary.savedGeneratedOutputs, 6);
  assert.equal(view.summary.activePublications, 2);
  assert.equal(view.summary.listedPublications, 2);
  assert.equal(view.summary.recordCandidates, 3);
  assert.equal(view.summary.versions, 1);
  assert.equal(view.summary.referenceOriginals, 1);
  assert.equal(view.summary.privateUploads, 1);
  assert.equal(view.summary.duplicateGroups, 1);
  assert.equal(view.summary.duplicateAssets, 2);
  assert.equal(view.summary.page.storageChecked, 8);
  assert.equal(view.summary.page.storageMissing, 1);
  assert.equal(view.summary.page.eligible, 1);
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE PROMPT|sha-candidate/);
});

test("the bounded backfill publishes one page at a time, skips already published items and reports missing bytes", async () => {
  const { env, project } = await setup();
  env.FIRST_PARTY_PUBLICATION_PROJECTS = project.id;
  const cookie = "studio_session=" + (await createSession(env));
  await env.DB.prepare(
    "INSERT INTO publication_policies(project_id,enabled,enabled_at,attested_at) VALUES(?1,1,1,1)",
  )
    .bind(project.id)
    .run();
  const one = await putBytes(env, await generated(env, project, { id: "asset_one", sha: "sha-one" }));
  await generated(env, project, { id: "asset_two_missing", sha: "sha-two" });
  await generated(env, project, { id: "asset_three_duplicate", sha: one.sha256 });
  const body = { confirm: true, rightsConfirmed: true, limit: 1 };

  const first = await (await request(env, `/api/projects/${project.id}/publication-backfill`, { cookie, method: "POST", data: body })).json();
  assert.equal(first.attempted, 1);
  assert.equal(first.created, 1);
  assert.deepEqual(first.results, [{ assetId: "asset_one", result: "created" }]);
  assert.equal(first.nextAfter, "asset_one");

  const second = await (
    await request(env, `/api/projects/${project.id}/publication-backfill`, { cookie, method: "POST", data: { ...body, after: "asset_one" } })
  ).json();
  assert.equal(second.attempted, 1);
  assert.equal(second.missingBytes, 1);
  assert.deepEqual(second.results, [{ assetId: "asset_two_missing", result: "bytes_missing" }]);
  assert.equal(second.nextAfter, "asset_two_missing");

  const third = await (
    await request(env, `/api/projects/${project.id}/publication-backfill`, { cookie, method: "POST", data: { ...body, after: "asset_two_missing" } })
  ).json();
  assert.equal(third.attempted, 0);
  assert.equal(third.created, 0);

  const rerun = await (await request(env, `/api/projects/${project.id}/publication-backfill`, { cookie, method: "POST", data: { ...body, limit: 10 } })).json();
  assert.equal(rerun.created, 0);

  const rows = await env.DB.prepare("SELECT asset_id FROM publications WHERE project_id=?1").bind(project.id).all();
  assert.deepEqual(rows.results.map((row) => row.asset_id), ["asset_one"]);
  assert.equal(
    (await request(env, `/api/projects/${project.id}/publication-backfill`, { cookie, method: "POST", data: { confirm: true, rightsConfirmed: true, limit: 26 } })).status,
    400,
  );
});

test("auto-publication stays off by default and an opted-in project publishes once", async () => {
  const { env, project } = await setup();
  const asset = await generated(env, project, { id: "asset_auto", sha: "sha-auto", created: 2 });
  assert.deepEqual(await policyFor(env, project.id), {
    installationAllowed: false,
    enabled: false,
    enabledAt: null,
    attestedAt: null,
  });
  assert.equal(await publishCandidate(env, project.id, asset.id, { automatic: true }), "not_allowed");
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM publications").first()).n, 0);

  env.FIRST_PARTY_PUBLICATION_PROJECTS = project.id;
  await env.DB.prepare(
    "INSERT INTO publication_policies(project_id,enabled,enabled_at,attested_at) VALUES(?1,1,1,1)",
  )
    .bind(project.id)
    .run();
  assert.equal(await publishCandidate(env, project.id, asset.id, { automatic: true }), "created");
  assert.equal(await publishCandidate(env, project.id, asset.id, { automatic: true }), "existing");
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM publications WHERE asset_id=?1").bind(asset.id).first()).n, 1);
  const upload = await addAsset(env, project, { id: "asset_auto_upload", kind: "image", source: "upload" });
  await env.DB.prepare("UPDATE assets SET sha256='sha-auto-upload' WHERE id=?1").bind(upload.id).run();
  assert.equal(await publishCandidate(env, project.id, upload.id, { automatic: true }), "skipped");
  assert.equal((await inventory(env, project.id)).items.find((item) => item.id === upload.id).excludedReason, "private_upload");
});
