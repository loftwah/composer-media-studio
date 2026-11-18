// MIT. Focused checks for the read-only storage doctor. Fictional fixtures only:
// no production D1/R2, no provider keys and no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { assetUsageReport, findDuplicateOriginal, projectStorageReport } from "../src/lib/storage-doctor.ts";
import { setup } from "./harness.mjs";

const sha = (label) => createHash("sha256").update(label).digest("hex");

async function insertAsset(env, project, {
  id,
  kind = "image",
  mime = "image/png",
  bytes = 4,
  fingerprint = null,
  title = `Fictional ${id}`,
  source = "upload",
  parentAssetId = null,
  generationId = null,
  deletedAt = null,
  erasurePending = 0,
  r2Key = null,
  object = true,
  createdAt = 1000,
}) {
  const digest = fingerprint ?? sha(`${project.id}:${id}`);
  const extension = mime.split("/")[1] === "jpeg" ? "jpg" : mime.split("/")[1] ?? "bin";
  const key = r2Key ?? `projects/${project.id}/assets/${id}/original.${extension}`;
  await env.DB.prepare(
    `INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,duration_ms,sample_rate,channels,sha256,title,caption,source,parent_asset_id,generation_id,created_at,updated_at,deleted_at,delete_revision,erasure_pending)
     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,'',?14,?15,?16,?17,?17,?18,1,?19)`,
  )
    .bind(
      id,
      project.id,
      kind,
      key,
      mime,
      bytes,
      kind === "image" ? 64 : null,
      kind === "image" ? 64 : null,
      kind === "audio" ? 10_000 : kind === "video" ? 5_000 : null,
      kind === "audio" ? 44_100 : null,
      kind === "audio" ? 2 : null,
      digest,
      title,
      source,
      parentAssetId,
      generationId,
      createdAt,
      deletedAt,
      erasurePending,
    )
    .run();
  if (object) {
    await env.MEDIA.put(key, new Uint8Array(bytes), {
      httpMetadata: { contentType: mime },
      customMetadata: { sha256: digest, project: project.id },
    });
  }
  return env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(id).first();
}

async function insertPublication(env, project, {
  id = "pub_fictional",
  assetId,
  posterAssetId = null,
  slug = "fictional-harbour",
  title = "Fictional harbour",
  revokedAt = null,
}) {
  await env.DB.prepare(
    "INSERT INTO publications(id,project_id,asset_id,poster_asset_id,slug,title,description,asset_revision,created_at,revoked_at,hidden,listed,attribution_json) VALUES(?1,?2,?3,?4,?5,?6,'',1,1000,?7,0,0,'[]')",
  )
    .bind(id, project.id, assetId, posterAssetId, slug, title, revokedAt)
    .run();
}

async function insertComposition(env, project, { id = "cmp_fictional", title = "Fictional harbour cut", spec }) {
  await env.DB.prepare(
    "INSERT INTO compositions(id,project_id,title,spec_json,created_at,updated_at) VALUES(?1,?2,?3,?4,1000,2000)",
  )
    .bind(id, project.id, title, JSON.stringify(spec))
    .run();
}

async function insertGeneration(env, project, {
  id = "gen_fictional",
  outputAssetId = null,
  request = {},
  kind = "video",
  model = "hailuo-standard",
  status = "saved",
}) {
  await env.DB.prepare(
    `INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,status,output_asset_id,cost_estimate_micro,cost_reserved_micro,created_at,updated_at)
     VALUES(?1,?2,?3,?4,'animate-still','fal',?5,?6,?7,?8,1000,1000,1000,1000)`,
  )
    .bind(id, project.id, `req_${id}`, kind, model, JSON.stringify(request), status, outputAssetId)
    .run();
}

async function ownerCookie(env) {
  return `studio_session=${await createSession(env, { mode: "owner" })}`;
}

function call(env, path, { cookie, method = "GET", body } = {}) {
  return worker.fetch(
    new Request(`https://studio.test${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        origin: "https://studio.test",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
    { waitUntil() {} },
  );
}

test("used-by graph names a real storyboard shot, soundtrack, slate and public page", async () => {
  const { env, project } = await setup({ projectId: "prj_fictional" });
  const clip = await insertAsset(env, project, {
    id: "asset_harbour_clip", kind: "video", mime: "video/mp4", bytes: 6, title: "Fictional harbour clip",
  });
  const track = await insertAsset(env, project, {
    id: "asset_harbour_track", kind: "audio", mime: "audio/wav", bytes: 8, title: "Fictional harbour bed",
  });
  const poster = await insertAsset(env, project, {
    id: "asset_harbour_poster", kind: "image", mime: "image/png", bytes: 5, title: "Fictional harbour poster",
  });
  await insertGeneration(env, project, {
    id: "gen_harbour_clip", outputAssetId: clip.id, request: { referenceAssetId: poster.id, prompt: "Fictional prompt" },
  });
  await insertComposition(env, project, {
    spec: {
      shots: [{ assetId: clip.id, durationMs: 5000 }],
      audioAssetId: null,
      audioTracks: [{ assetId: track.id, role: "music", startMs: 0, trimStartMs: 0, trimEndMs: 5000, gainDb: 0, fadeInMs: 0, fadeOutMs: 0 }],
      slateAssetId: poster.id,
      totalMs: 5000,
    },
  });
  await insertPublication(env, project, { assetId: clip.id, posterAssetId: poster.id });

  const report = await projectStorageReport(env, project);
  assert.equal(report.readOnly, true);
  assert.equal(report.writes, 0);
  assert.equal(report.coverage.complete, true);

  const clipUses = report.usedBy[clip.id];
  assert.ok(clipUses.some((use) => use.type === "storyboard_shot" && use.parentId === "cmp_fictional"));
  assert.ok(clipUses.some((use) => use.type === "publication" && use.href === "/p/fictional-harbour"));
  assert.ok(clipUses.some((use) => use.type === "generation_output"));
  assert.ok(clipUses.every((use) => use.href && use.label));

  const posterUses = report.usedBy[poster.id];
  assert.ok(posterUses.some((use) => use.type === "storyboard_slate"));
  assert.ok(posterUses.some((use) => use.type === "publication_poster"));
  assert.ok(posterUses.some((use) => use.type === "generation_reference"));

  const trackUses = report.usedBy[track.id];
  assert.ok(trackUses.some((use) => use.type === "storyboard_track" && use.detail.includes("music")));

  const clipEntry = report.assets.find((entry) => entry.id === clip.id);
  assert.equal(clipEntry.referenceState, "used");
  assert.equal(clipEntry.published, true);
  assert.equal(clipEntry.protected, true);
  assert.ok(report.totals.protectedAssets >= 3);
  assert.equal(report.published[0].href, "/p/fictional-harbour");

  const usage = await assetUsageReport(env, project, clip.id);
  assert.equal(usage.readOnly, true);
  assert.equal(usage.writes, 0);
  assert.equal(usage.asset.referenceState, "used");
  assert.ok(usage.uses.some((use) => use.href === "#/p/prj_fictional/assemble"));
  assert.ok(usage.uses.some((use) => use.href === "/p/fictional-harbour"));
});

test("assets without provenance are unknown, while a complete unused upload is unused", async () => {
  const { env, project } = await setup({ projectId: "prj_states" });
  const unused = await insertAsset(env, project, {
    id: "asset_unused_upload", title: "Fictional unused upload", object: true,
  });
  const legacy = await insertAsset(env, project, {
    id: "asset_legacy_generated", title: "Fictional legacy result", source: "generated", object: true,
  });

  const report = await projectStorageReport(env, project);
  const unusedEntry = report.assets.find((entry) => entry.id === unused.id);
  const legacyEntry = report.assets.find((entry) => entry.id === legacy.id);
  assert.equal(unusedEntry.referenceState, "unused");
  assert.equal(unusedEntry.legacyReasons.length, 0);
  assert.equal(legacyEntry.referenceState, "unknown");
  assert.ok(legacyEntry.legacyReasons.includes("generation_missing"));
  assert.ok(report.unknownLegacy.some((entry) => entry.assetId === legacy.id));
  assert.equal(report.totals.unknownLegacyRows, 1);

  const usage = await assetUsageReport(env, project, legacy.id);
  assert.equal(usage.asset.referenceState, "unknown");
  assert.ok(usage.asset.legacyReasons.includes("generation_missing"));
  assert.ok(usage.notes.some((note) => note.includes("unknown, not unused")));
});

test("same filename with different bytes is not a duplicate", async () => {
  const { env, project } = await setup({ projectId: "prj_names" });
  const first = await insertAsset(env, project, {
    id: "asset_same_name_first", title: "fictional-same-name", fingerprint: sha("first bytes"), bytes: 4,
  });
  await insertAsset(env, project, {
    id: "asset_same_name_second", title: "fictional-same-name", fingerprint: sha("second bytes"), bytes: 4,
  });

  const lookup = await findDuplicateOriginal(env, project, {
    sha256: sha("third bytes"), size: 4, mime: "image/png", filename: "fictional-same-name.png",
  });
  assert.equal(lookup.valid, true);
  assert.equal(lookup.duplicate, null);

  const cookie = await ownerCookie(env);
  const preflight = await call(env, `/api/projects/${project.id}/assets/preflight`, {
    cookie,
    method: "POST",
    body: { sha256: sha("third bytes"), size: 4, mime: "image/png", filename: "fictional-same-name.png" },
  });
  assert.equal(preflight.status, 200);
  const payload = await preflight.json();
  assert.equal(payload.writes, 0);
  assert.equal(payload.filenameUsed, false);
  assert.equal(payload.duplicate, null);

  const report = await projectStorageReport(env, project);
  assert.equal(report.duplicateContent.length, 0);
  assert.equal(report.assets.find((entry) => entry.id === first.id).referenceState, "unused");
});

test("same bytes, size and MIME are reported and reused without a second object or lineage change", async () => {
  const { env, project } = await setup({ projectId: "prj_reuse" });
  const digest = sha("same fictional bytes");
  const source = await insertAsset(env, project, {
    id: "asset_reuse_source", title: "Fictional source still", bytes: 5, createdAt: 800,
  });
  const original = await insertAsset(env, project, {
    id: "asset_reuse_original", title: "Fictional original", fingerprint: digest, bytes: 7,
    source: "variant", parentAssetId: source.id, generationId: "gen_reuse", createdAt: 900,
  });
  await insertGeneration(env, project, {
    id: "gen_reuse", outputAssetId: original.id, kind: "image", model: "studio-detail", request: { referenceAssetId: source.id },
  });
  const copy = await insertAsset(env, project, {
    id: "asset_reuse_copy", title: "Fictional second upload", fingerprint: digest, bytes: 7, source: "upload", createdAt: 1000,
  });

  const report = await projectStorageReport(env, project);
  assert.equal(report.duplicateContent.length, 1);
  assert.deepEqual(new Set(report.duplicateContent[0].assetIds), new Set([original.id, copy.id]));
  assert.equal(report.duplicateContent[0].extraBytes, 7);
  assert.equal(report.totals.duplicateExtraAssets, 1);

  const lookup = await findDuplicateOriginal(env, project, { sha256: digest, size: 7, mime: "image/png" });
  assert.equal(lookup.duplicate.id, original.id);

  const cookie = await ownerCookie(env);
  const preflight = await call(env, `/api/projects/${project.id}/assets/preflight`, {
    cookie,
    method: "POST",
    body: { sha256: digest, size: 7, mime: "image/png" },
  });
  assert.equal(preflight.status, 200);
  const preflightPayload = await preflight.json();
  assert.equal(preflightPayload.writes, 0);
  assert.equal(preflightPayload.duplicate.id, original.id);
  assert.equal(preflightPayload.duplicate.parentAssetId, source.id);
  assert.equal(preflightPayload.duplicate.generationId, "gen_reuse");

  const beforeAssets = env.DB.db.prepare("SELECT COUNT(*) AS n FROM assets").get().n;
  const beforePuts = env.MEDIA.puts.length;
  const beforeRow = env.DB.db.prepare("SELECT * FROM assets WHERE id=?").get(original.id);

  const response = await call(env, `/api/projects/${project.id}/assets/reuse`, {
    cookie,
    method: "POST",
    body: { assetId: original.id, sha256: digest, size: 7, mime: "image/png" },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.reused, true);
  assert.equal(payload.writes, 0);
  assert.equal(payload.asset.id, original.id);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM assets").get().n, beforeAssets);
  assert.equal(env.MEDIA.puts.length, beforePuts);
  assert.deepEqual(env.DB.db.prepare("SELECT * FROM assets WHERE id=?").get(original.id), beforeRow);
});

test("duplicate lookup and reuse never disclose another project's original", async () => {
  const { env, project } = await setup({ projectId: "prj_scope_a" });
  await env.DB.prepare(
    "INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES('prj_scope_b','Fictional other studio','slug-prj-scope-b','','private','{}',1000,1000)",
  ).run();
  const secondProject = await env.DB.prepare("SELECT * FROM projects WHERE id='prj_scope_b'").first();
  const other = await insertAsset(env, secondProject, {
    id: "asset_other_project", title: "Fictional other project original", bytes: 9,
  });
  const otherDigest = other.sha256;

  const lookup = await findDuplicateOriginal(env, project, { sha256: otherDigest, size: 9, mime: "image/png" });
  assert.equal(lookup.duplicate, null);

  const cookie = await ownerCookie(env);
  const response = await call(env, `/api/projects/${project.id}/assets/reuse`, {
    cookie,
    method: "POST",
    body: { assetId: other.id, sha256: otherDigest, size: 9, mime: "image/png" },
  });
  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.equal(payload.error.code, "duplicate_not_found");
  assert.equal(JSON.stringify(payload).includes("prj_scope_b"), false);

  const readOnlyBridge = `studio_session=${await createSession(env, {
    mode: "bridge",
    actor: "fictional-member",
    workspace: "ws-fictional",
    project: "prj_scope_a",
    actions: ["read"],
  })}`;
  const forbidden = await call(env, `/api/projects/${project.id}/storage-report`, { cookie: readOnlyBridge });
  assert.equal(forbidden.status, 403);

  const otherProject = await call(env, `/api/projects/prj_scope_b/storage-report`, { cookie });
  assert.equal(otherProject.status, 200);
});

test("a missing R2 object is reported and remains a protected saved reference", async () => {
  const { env, project } = await setup({ projectId: "prj_missing" });
  const missing = await insertAsset(env, project, {
    id: "asset_missing_bytes", title: "Fictional missing object", bytes: 12, object: false,
  });
  await insertPublication(env, project, { assetId: missing.id, slug: "fictional-missing", title: "Fictional missing" });

  const report = await projectStorageReport(env, project);
  assert.equal(report.totals.missingObjects, 1);
  assert.equal(report.totals.missingBytes, 12);
  assert.deepEqual(report.missingReferencedObjects.map((entry) => entry.assetId), [missing.id]);
  const entry = report.assets.find((asset) => asset.id === missing.id);
  assert.equal(entry.storage, "missing");
  assert.equal(entry.referenceState, "used");
  assert.equal(entry.protected, true);
  assert.equal(report.published[0].assetId, missing.id);
});

test("a tombstoned asset is outside live totals, duplicates and reuse, but its broken reference is shown", async () => {
  const { env, project } = await setup({ projectId: "prj_deleted" });
  const deleted = await insertAsset(env, project, {
    id: "asset_deleted_film", kind: "video", mime: "video/mp4", bytes: 10, title: "Fictional deleted film",
    deletedAt: 2000, erasurePending: 1, object: false,
  });
  await insertPublication(env, project, {
    id: "pub_deleted", assetId: deleted.id, slug: "fictional-withdrawn", title: "Fictional withdrawn", revokedAt: null,
  });

  const report = await projectStorageReport(env, project);
  assert.equal(report.totals.liveAssets, 0);
  assert.equal(report.totals.tombstonedAssets, 1);
  assert.equal(report.totals.erasurePending, 1);
  assert.equal(report.assets.length, 0);
  assert.equal(report.duplicateContent.length, 0);
  assert.ok(report.danglingReferences.some((entry) => entry.assetId === deleted.id && entry.reason === "asset_tombstoned"));

  const lookup = await findDuplicateOriginal(env, project, { sha256: deleted.sha256, size: 10, mime: "video/mp4" });
  assert.equal(lookup.duplicate, null);

  const usage = await assetUsageReport(env, project, deleted.id);
  assert.equal(usage.asset.referenceState, "tombstoned");
  assert.ok(usage.uses.some((use) => use.type === "publication"));
});

test("report, preflight and reuse make zero D1 or R2 writes", async () => {
  const { env, project } = await setup({ projectId: "prj_readonly" });
  const clip = await insertAsset(env, project, { id: "asset_ro_clip", kind: "video", mime: "video/mp4", bytes: 6 });
  await insertComposition(env, project, {
    id: "cmp_ro", title: "Fictional read-only cut", spec: { shots: [{ assetId: clip.id }], audioTracks: [], totalMs: 5000 },
  });
  await insertPublication(env, project, { id: "pub_ro", assetId: clip.id, slug: "fictional-readonly" });

  const tables = ["assets", "generations", "compositions", "publications", "subject_versions", "song_plans", "footage_plans", "local_render_receipts", "footage_export_receipts", "review_rooms", "project_bundle_imports", "grant_checks"];
  const snapshot = Object.fromEntries(tables.map((table) => [table, env.DB.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
  const keysBefore = [...env.MEDIA.objects.keys()].sort();
  const putsBefore = env.MEDIA.puts.length;
  const statements = [];
  const originalPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => {
    statements.push(sql.trim().split(/\s+/, 1)[0].toUpperCase());
    return originalPrepare(sql);
  };

  try {
    const report = await projectStorageReport(env, project);
    assert.equal(report.writes, 0);
    assert.equal(report.readOnly, true);
    const lookup = await findDuplicateOriginal(env, project, { sha256: clip.sha256, size: 6, mime: "video/mp4" });
    assert.equal(lookup.duplicate.id, clip.id);
    const usage = await assetUsageReport(env, project, clip.id);
    assert.equal(usage.writes, 0);

    const cookie = await ownerCookie(env);
    const response = await call(env, `/api/projects/${project.id}/storage-report`, { cookie });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.readOnly, true);
    assert.equal(payload.writes, 0);
    assert.ok(statements.every((keyword) => keyword === "SELECT" || keyword === "WITH"));
  } finally {
    env.DB.prepare = originalPrepare;
  }

  assert.deepEqual([...env.MEDIA.objects.keys()].sort(), keysBefore);
  assert.equal(env.MEDIA.puts.length, putsBefore);
  for (const table of tables)
    assert.equal(env.DB.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, snapshot[table], `${table} changed`);
});
