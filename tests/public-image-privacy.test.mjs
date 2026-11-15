import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32 } from "node:zlib";
import { createSession } from "../src/lib/auth.mjs";
import { publishCandidate } from "../src/lib/publication-policy.mjs";
import { sha256Hex } from "../src/lib/util.mjs";
import worker from "../src/worker.mjs";
import { PNG_1x1, setup } from "./harness.mjs";

const privatePrompt = "Private synthetic prompt used only in this fixture";
function withChunk(type, value) {
  const payload = Buffer.from(value);
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length);
  chunk.write(type, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return Buffer.concat([PNG_1x1.subarray(0, 33), chunk, PNG_1x1.subarray(33)]);
}
const withPrompt = withChunk("tEXt", `Comment\0${privatePrompt}`);
const signedOriginal = withChunk("caBX", "Synthetic C2PA container");

async function still(env, project, suffix, bytes) {
  const id = `asset_${suffix}`;
  const generationId = `gen_${suffix}`;
  await env.DB.prepare(`INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,status,cost_estimate_micro,cost_reserved_micro,created_at,updated_at)
    VALUES(?1,?2,?1,'image','still','cloudflare','studio-print',?3,'saved',0,0,3,3)`)
    .bind(generationId, project.id, JSON.stringify({ referenceAssetId: null, parentAssetId: null, darkroomVersion: "0.10.0" })).run();
  await env.MEDIA.put(id, bytes);
  await env.DB.prepare(`INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,sha256,title,source,generation_id,created_at,updated_at)
    VALUES(?1,?2,'image',?1,'image/png',?3,?4,'Synthetic image','generated',?5,3,3)`)
    .bind(id, project.id, bytes.length, await sha256Hex(bytes), generationId).run();
  await env.DB.prepare("UPDATE generations SET output_asset_id=?2 WHERE id=?1").bind(generationId, id).run();
  return id;
}

test("Darkroom metadata and signed originals stay private across publication routes", async () => {
  const { env, project } = await setup();
  const clean = await still(env, project, "clean", PNG_1x1);
  const privateImage = await still(env, project, "private", withPrompt);
  const signedImage = await still(env, project, "signed", signedOriginal);
  const cookie = `studio_session=${await createSession(env)}`;
  const fetchStudio = (path, init) => worker.fetch(new Request(`https://studio.test${path}`, init), env);
  const publish = (asset, input = {}) => fetchStudio(`/api/assets/${asset}/publish`, {
    method: "POST", body: JSON.stringify(input), headers: { cookie, "content-type": "application/json" },
  });

  await env.DB.prepare("INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,sha256,title,source,created_at,updated_at) VALUES('asset_movie',?1,'video','movie','video/mp4',1,'hash','Film','upload',1,1)")
    .bind(project.id).run();
  assert.equal((await publish(privateImage)).status, 409);
  assert.equal((await publish(signedImage)).status, 409);
  assert.equal((await publish("asset_movie", { posterAssetId: privateImage })).status, 409);
  env.FIRST_PARTY_PUBLICATION_PROJECTS = project.id;
  await env.DB.prepare("INSERT INTO publication_policies(project_id,enabled,enabled_at,attested_at) VALUES(?1,1,1,1)").bind(project.id).run();
  assert.equal(await publishCandidate(env, project.id, privateImage, { automatic: true }), "metadata_review_required");
  assert.equal((await env.DB.prepare("SELECT count(*) AS count FROM publications").first()).count, 0);
  assert.deepEqual(await (await env.MEDIA.get(privateImage)).arrayBuffer(), await new Blob([withPrompt]).arrayBuffer());
  assert.deepEqual(await (await env.MEDIA.get(signedImage)).arrayBuffer(), await new Blob([signedOriginal]).arrayBuffer());

  const published = await publish(clean);
  assert.equal(published.status, 201, await published.clone().text());
  const { publication } = await published.json();
  const full = await fetchStudio(`${publication.path}/media`);
  assert.equal(full.status, 200);
  assert.deepEqual(new Uint8Array(await full.arrayBuffer()), PNG_1x1);
  const partial = await fetchStudio(`${publication.path}/download`, { headers: { range: "bytes=0-7" } });
  assert.equal(partial.status, 206);
  assert.deepEqual(new Uint8Array(await partial.arrayBuffer()), PNG_1x1.subarray(0, 8));
  const head = await fetchStudio(`${publication.path}/media`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), PNG_1x1.length);

  // Even a publication row created before a preflight, or outside it, cannot
  // expose the original. The same check covers the poster and legacy aliases.
  await env.DB.prepare("INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at) VALUES('pub_legacy',?1,?2,'preflight-missed','Image','',1,1)")
    .bind(project.id, privateImage).run();
  await env.DB.prepare("INSERT INTO publications(id,project_id,asset_id,poster_asset_id,slug,title,description,asset_revision,created_at) VALUES('pub_movie',?1,'asset_movie',?2,'poster-missed','Film','',1,1)")
    .bind(project.id, privateImage).run();
  for (const [path, init] of [
    ["/p/preflight-missed/media"],
    ["/p/preflight-missed/download", { headers: { range: "bytes=0-1" } }],
    ["/p/preflight-missed/media", { method: "HEAD" }],
    ["/p/poster-missed/poster"],
    ["/s/preflight-missed"],
  ]) {
    const response = await fetchStudio(path, init);
    assert.equal(response.status, 404, path);
    assert.equal((await response.text()).includes(privatePrompt), false);
  }
});
