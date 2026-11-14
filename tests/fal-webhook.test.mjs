// MIT. fal webhook contract: verify fal's signature, save once, ignore a
// re-delivery, and record a terminal provider error without a refund claim.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { handleFalWebhook, resetWebhookKeyCache } from "../src/lib/fal-webhook.mjs";
import { loadGeneration } from "../src/lib/jobs.mjs";
import { setup } from "./harness.mjs";

const { subtle } = webcrypto;

async function keypair() {
  const pair = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  const x = Buffer.from(raw).toString("base64url");
  return { privateKey: pair.privateKey, jwks: { keys: [{ x }] } };
}

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function signedRequest(body, { privateKey, requestId = "req_web" } = {}) {
  const raw = new TextEncoder().encode(JSON.stringify(body));
  const digest = createHash("sha256").update(raw).digest("hex");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const userId = "user_test";
  const message = new TextEncoder().encode(`${requestId}\n${userId}\n${timestamp}\n${digest}`);
  const signature = await subtle.sign({ name: "Ed25519" }, privateKey, message);
  return new Request("https://media.loftwah.com/api/fal/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-fal-webhook-request-id": requestId,
      "x-fal-webhook-user-id": userId,
      "x-fal-webhook-timestamp": timestamp,
      "x-fal-webhook-signature": Buffer.from(signature).toString("hex"),
    },
    body: raw,
  });
}

async function submitted(env, project, requestId = "req_web") {
  const timestamp = Date.now();
  await env.DB.prepare("INSERT INTO budgets(project_id,period,allowance_micro,reserved_micro,spent_micro,updated_at) VALUES(?1,?2,5000000,20000,0,?3) ON CONFLICT(project_id,period) DO UPDATE SET reserved_micro=reserved_micro+20000").bind(project.id,new Date(timestamp).toISOString().slice(0,7),timestamp).run();
  await env.DB.prepare(
    `INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,status,provider_request_id,cost_estimate_micro,cost_reserved_micro,created_at,updated_at,submitted_at)
     VALUES('gen_web',?1,'req_web_job','video','composition','fal','studio-assembly','{}','submitted',?2,20000,20000,?3,?3,?3)`,
  )
    .bind(project.id, requestId, timestamp)
    .run();
  return loadGeneration(env, "gen_web");
}

async function withFetch(handlers, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => handlers(String(url));
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = original;
    });
}

const mediaHandler = (url) =>
  url.includes("rest.fal.ai")
    ? null
    : new Response(Uint8Array.from([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      });

test("a verified delivery saves the finished master once", async () => {
  const { env, project } = await setup();
  await submitted(env, project);
  resetWebhookKeyCache();
  const { privateKey, jwks } = await keypair();
  const body = {
    request_id: "req_web",
    status: "OK",
    payload: { video: { url: "https://v3.fal.media/files/master.mp4", content_type: "video/mp4" } },
  };
  const request = await signedRequest(body, { privateKey });
  await withFetch((url) => (url.includes("rest.fal.ai") ? new Response(JSON.stringify(jwks)) : mediaHandler(url)), async () => {
    const first = await handleFalWebhook(request, { ...env, FAL_KEY: "k" });
    assert.equal(first.status, 200);
    const saved = await loadGeneration(env, "gen_web");
    assert.equal(saved.status, "saved");
    assert.ok(saved.output_asset_id);
    const again = await handleFalWebhook(await signedRequest(body, { privateKey }), { ...env, FAL_KEY: "k" });
    assert.equal(again.status, 200);
    const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM assets").all();
    assert.equal(results[0].n, 1);
  });
});

test("an unsigned or wrongly signed delivery writes nothing", async () => {
  const { env, project } = await setup();
  await submitted(env, project);
  resetWebhookKeyCache();
  const { privateKey, jwks } = await keypair();
  const other = await keypair();
  const body = {
    request_id: "req_web",
    status: "OK",
    payload: { video: { url: "https://v3.fal.media/files/master.mp4" } },
  };
  const request = await signedRequest(body, { privateKey: other.privateKey });
  await withFetch((url) => (url.includes("rest.fal.ai") ? new Response(JSON.stringify(jwks)) : mediaHandler(url)), async () => {
    const response = await handleFalWebhook(request, { ...env, FAL_KEY: "k" });
    assert.equal(response.status, 401);
    const job = await loadGeneration(env, "gen_web");
    assert.equal(job.status, "submitted");
    assert.equal(job.output_asset_id, null);
  });
});

test("a provider error delivery fails the job with its own detail", async () => {
  const { env, project } = await setup();
  await submitted(env, project);
  resetWebhookKeyCache();
  const { privateKey, jwks } = await keypair();
  const body = {
    request_id: "req_web",
    status: "ERROR",
    error: "Invalid status code: 422",
    payload: { detail: "video_urls must contain at least 2 items" },
  };
  await withFetch((url) => (url.includes("rest.fal.ai") ? new Response(JSON.stringify(jwks)) : mediaHandler(url)), async () => {
    const response = await handleFalWebhook(await signedRequest(body, { privateKey }), { ...env, FAL_KEY: "k" });
    assert.equal(response.status, 200);
    const job = await loadGeneration(env, "gen_web");
    assert.equal(job.status, "failed");
    assert.equal(job.error_code, "provider_rejected");
    assert.match(job.error_detail, /422|video_urls/);
    assert.equal(job.cost_observed_micro, null);
  });
});

test("an unknown request id is acknowledged without touching a job", async () => {
  const { env, project } = await setup();
  await submitted(env, project);
  resetWebhookKeyCache();
  const { privateKey, jwks } = await keypair();
  const body = { request_id: "req_other", status: "OK", payload: {} };
  await withFetch((url) => (url.includes("rest.fal.ai") ? new Response(JSON.stringify(jwks)) : mediaHandler(url)), async () => {
    const response = await handleFalWebhook(await signedRequest(body, { privateKey, requestId: "req_other" }), {
      ...env,
      FAL_KEY: "k",
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ignored, "unknown_request");
    const job = await loadGeneration(env, "gen_web");
    assert.equal(job.status, "submitted");
  });
});
