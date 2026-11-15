import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { budgetSnapshot, createGeneration, dispatchGeneration, saveGeneration } from "../src/lib/jobs.mjs";
import { PNG_1x1, setup } from "./harness.mjs";
import { withDarkroom } from "./support/darkroom-env.mjs";

async function fixture() {
  const { env, project } = await setup();
  withDarkroom(env);
  env.AI = { run: async () => ({ image: Buffer.from(PNG_1x1).toString("base64") }) };
  const { generation } = await createGeneration(env, project, {
    kind: "image", model: "studio-print", prompt: "Fictional fixture", aspect: "square", clientRequestId: "req_delete",
  });
  const cookie = `studio_session=${await createSession(env)}`;
  const access = (path, method) => worker.fetch(new Request(`https://studio.test/api/${path}`, {
    method, headers: { cookie },
  }), env, { waitUntil() {} });
  return { env, project, generation, remove: path => access(path, "DELETE"), read: path => access(path, "GET") };
}

test("an interrupted asset deletion is retried by the sweep after the tombstone", async () => {
  const { env, generation, remove, read } = await fixture();
  const saved = await dispatchGeneration(env, generation);
  assert.equal(saved.status, "saved", saved.error_detail);
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(saved.output_asset_id).first();
  const retained = `media-output/v1/media:${generation.id}`;

  const erase = env.MEDIA.delete.bind(env.MEDIA);
  env.MEDIA.delete = async key => {
    if (key === saved.retained_key) throw new Error("fictional storage interruption");
    return erase(key);
  };
  assert.equal((await remove(`assets/${asset.id}`)).status, 502);
  assert.equal(asset.r2_key, saved.retained_key);
  assert.equal((await read(`assets/${asset.id}/file`)).status, 410);
  assert.ok(await env.MEDIA.head(saved.retained_key));
  assert.ok(await env.APP_ARTIFACTS.head(retained));

  env.MEDIA.delete = erase;
  const work = [];
  await worker.scheduled({}, env, { waitUntil(promise) { work.push(promise); } });
  await Promise.all(work);
  assert.equal(await env.MEDIA.head(saved.retained_key), null);
  assert.equal(await env.APP_ARTIFACTS.head(retained), null);
  const repeat = await remove(`assets/${asset.id}`);
  assert.equal(repeat.status, 200);
  assert.deepEqual(await repeat.json(), { deleted: true, alreadyDeleted: true });
});

test("deleting a generation while its asset bytes are being saved prevents indexing the late asset", async () => {
  const { env, project, generation, remove } = await fixture();
  await env.DB.prepare("UPDATE generations SET status='submitting' WHERE id=?1").bind(generation.id).run();
  const put = env.MEDIA.put.bind(env.MEDIA);
  env.MEDIA.put = async (key, bytes, metadata) => {
    const result = await put(key, bytes, metadata);
    if (key.includes("/assets/")) {
      const response = await remove(`generations/${generation.id}`);
      assert.equal(response.status, 200);
    }
    return result;
  };
  const result = await saveGeneration(env, generation, PNG_1x1, "png");
  assert.equal(result.status, "discarded_after_delete");
  assert.equal(await env.DB.prepare("SELECT id FROM assets WHERE generation_id=?1").bind(generation.id).first(), null);
  assert.equal(env.MEDIA.objects.size, 0);
  const budget = await budgetSnapshot(env, project.id);
  assert.equal(budget.reservedMicro, 0);
  assert.equal(budget.spentMicro, generation.cost_reserved_micro);
});
