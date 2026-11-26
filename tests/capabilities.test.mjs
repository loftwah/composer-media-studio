// MIT. Focused checks for the read-only capability manifest and freshness
// refresh. No inference, no provider credential and no production write.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITIES_KEY,
  CAPABILITIES_STATE_KEY,
  buildAlerts,
  capabilityManifest,
  falModelMatches,
  parseCloudflareModelPage,
  parseFalModel,
  refreshCapabilities,
} from "../src/lib/capabilities.ts";
import { publicDiagnosticsResponse } from "../src/lib/public-diagnostics.ts";
import { FakeBucket } from "./harness.mjs";

test("a public Workers AI page exposes its retirement date and price", () => {
  const parsed = parseCloudflareModelPage(`# stable-diffusion-xl-lightning\n\n| Model Info | |\n| --- | --- |\n| Planned Deprecation | 11/20/2026 |\n| Unit Pricing | $0.00 per step |\n`);
  assert.equal(parsed.retirementDate, "2026-11-20");
  assert.equal(parsed.pricing, "$0.00 per step");
  assert.equal(parseCloudflareModelPage("# nothing").retirementDate, null);
});

test("fal model search carries withdrawal and price facts", () => {
  assert.deepEqual(
    parseFalModel({ id: "fal-ai/x", deprecated: true, removed: false, status: "public", pricingInfoOverride: "$0.28", updatedAt: "2026-11-01" }),
    { id: "fal-ai/x", deprecated: true, removed: false, status: "public", pricing: "$0.28", updatedAt: "2026-11-01" },
  );
  assert.equal(parseFalModel(null), null);
  assert.equal(falModelMatches("fal-ai/elevenlabs/sound-effects/v3", { id: "elevenlabs/sound-effects/v3" }), true);
  assert.equal(falModelMatches("fal-ai/minimax/hailuo-2.3/standard/image-to-video", { id: "fal-ai/minimax/hailuo-2.3/standard/image-to-video" }), true);
  assert.equal(falModelMatches("fal-ai/a", { id: "fal-ai/b" }), false);
});

test("alerts are stable and deduplicated by model and problem", () => {
  const source = {
    model: "studio-craft",
    provider: "fal",
    source: "https://fal.ai/api/models?keywords=x",
    status: "ok",
    pricing: "$2",
    checkedAt: "2026-11-15T00:00:00.000Z",
  };
  const alerts = buildAlerts([source, source], [{ ...source, pricing: "$1" }]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].id, "pricing:studio-craft");
  assert.equal(alerts[0].previous, "$1");
  assert.equal(alerts[0].current, "$2");
});

test("the manifest names the enabled and retired models with exact endpoints", () => {
  const manifest = capabilityManifest({ checkedAt: "2026-11-15T00:00:00.000Z" });
  assert.equal(manifest.contract, "media-studio-capabilities");
  assert.equal(manifest.version, 1);
  assert.ok(manifest.models.some((model) => model.id === "studio-craft" && model.endpoint === "@cf/black-forest-labs/flux-2-klein-9b"));
  assert.ok(manifest.retired.some((model) => model.id === "studio-draft" && model.endpoint === "@cf/bytedance/stable-diffusion-xl-lightning"));
  assert.deepEqual(manifest.frames, ["square", "portrait", "landscape", "wide"]);
  const composer = manifest.models.filter((model) => model.composer).map((model) => model.id);
  assert.deepEqual(composer, ["studio-print", "studio-film", "studio-craft", "studio-quick", "hailuo-standard", "kling-standard", "studio-score", "studio-voice"]);
});

function cloudflareResponse(url, price) {
  const slug = new URL(url).pathname.split("/").at(-2);
  const endpoint = capabilityManifest().models.find((model) => model.endpoint.endsWith("/" + slug)).endpoint;
  return new Response(`# ${slug}\n\nModel ID\n\n\`${endpoint}\` Copy\n\n| Unit Pricing | ${price} |\n`);
}

function modelsDevResponse() {
  return Response.json({ fictional: { id: "fictional", name: "Fictional catalogue", models: {} } });
}

function refreshEnv({ fail = false } = {}) {
  const bucket = new FakeBucket();
  const env = { MEDIA: bucket, AI: { run() { throw new Error("Inference must not run during refresh"); } } };
  let prices = "$1";
  const fetchImpl = async (url) => {
    if (fail && String(url).includes("flux-2-klein-9b")) throw new Error("network down");
    if (String(url).startsWith("https://models.dev/")) return modelsDevResponse();
    if (String(url).startsWith("https://fal.ai/api/models")) {
      const endpoint = decodeURIComponent(new URL(url).searchParams.get("keywords"));
      return new Response(JSON.stringify({ items: [{ id: endpoint, deprecated: false, removed: false, status: "public", pricingInfoOverride: prices }] }));
    }
    if (String(url).includes("/workers-ai/models/")) {
      return cloudflareResponse(url, prices);
    }
    throw new Error("unexpected source " + url);
  };
  return { env, bucket, fetchImpl, setPrice: (value) => { prices = value; } };
}

test("a complete refresh keeps the manifest and spends nothing", async () => {
  const { env, bucket, fetchImpl } = refreshEnv();
  const result = await refreshCapabilities(env, { now: Date.parse("2026-11-15T00:00:00Z"), fetchImpl });
  assert.equal(result.skipped, false);
  assert.equal(result.state.outcome, "complete");
  assert.equal(result.state.modelCalls, 0);
  assert.equal(result.state.issuesWritten, 0);
  assert.ok(bucket.objects.has(CAPABILITIES_KEY));
  assert.ok(bucket.objects.has(CAPABILITIES_STATE_KEY));
  const stored = JSON.parse(new TextDecoder().decode(bucket.objects.get(CAPABILITIES_KEY)));
  assert.equal(stored.checkedAt, "2026-11-15T00:00:00.000Z");
  assert.equal(stored.lastGoodAt, "2026-11-15T00:00:00.000Z");
  const state = JSON.parse(new TextDecoder().decode(bucket.objects.get(CAPABILITIES_STATE_KEY)));
  assert.equal(state.nextDueAt, "2026-11-16T00:00:00.000Z");
});

test("a partial refresh retains the last good manifest and raises one schema item", async () => {
  const { env, fetchImpl } = refreshEnv();
  await refreshCapabilities(env, { now: Date.parse("2026-11-15T00:00:00Z"), fetchImpl });
  const partial = refreshEnv({ fail: true });
  const result = await refreshCapabilities(env, { now: Date.parse("2026-11-16T00:00:00Z"), fetchImpl: partial.fetchImpl });
  assert.equal(result.state.outcome, "partial");
  assert.equal(result.manifest.lastGoodAt, "2026-11-15T00:00:00.000Z");
  assert.ok(result.manifest.alerts.some((alert) => alert.id === "schema:studio-craft:cloudflare-workers-ai"));
  assert.ok(env.MEDIA.objects.has(CAPABILITIES_KEY), "the failed run still records what it checked");
});

test("a provider price change creates one migration item, not a new default", async () => {
  const { env, fetchImpl, setPrice } = refreshEnv();
  await refreshCapabilities(env, { now: Date.parse("2026-11-15T00:00:00Z"), fetchImpl });
  setPrice("$2");
  const result = await refreshCapabilities(env, { now: Date.parse("2026-11-16T00:00:00Z"), fetchImpl });
  const pricing = result.manifest.alerts.filter((alert) => alert.kind === "pricing");
  assert.ok(pricing.length > 0);
  assert.ok(pricing.every((alert) => alert.id.startsWith("pricing:")));
  assert.equal(result.manifest.models.find((model) => model.id === "studio-craft").costMicro, 16_000, "the default estimate is unchanged until reviewed");
});

test("fal lifecycle facts are retained and raise retirement alerts", async () => {
  const bucket = new FakeBucket();
  const env = { MEDIA: bucket, AI: { run() { throw new Error("Inference must not run during refresh"); } } };
  const fetchImpl = async (url) => {
    if (String(url).startsWith("https://models.dev/")) return modelsDevResponse();
    if (String(url).startsWith("https://fal.ai/api/models")) {
      const endpoint = decodeURIComponent(new URL(url).searchParams.get("keywords"));
      const deprecated = endpoint.includes("hailuo");
      const removed = endpoint.includes("kling");
      return Response.json({ items: [{ id: endpoint, deprecated, removed, status: "public", pricingInfoOverride: "$1", updatedAt: "2026-11-01" }] });
    }
    if (String(url).includes("/workers-ai/models/")) {
      return cloudflareResponse(url, "$1");
    }
    throw new Error("unexpected source " + url);
  };
  const result = await refreshCapabilities(env, { now: Date.parse("2026-11-15T00:00:00Z"), fetchImpl });
  assert.equal(result.state.outcome, "complete");
  assert.ok(result.manifest.alerts.some((alert) => alert.id === "retirement:hailuo-standard"));
  assert.match(result.manifest.alerts.find((alert) => alert.id === "retirement:kling-standard").message, /marked removed/);
  const source = result.manifest.sources.find((item) => item.model === "hailuo-standard");
  assert.equal(source.deprecated, true);
  assert.equal(source.updatedAt, "2026-11-01");
  assert.equal(result.manifest.sources.find((item) => item.model === "kling-standard").removed, true);
  const { fetchImpl: recovered } = refreshEnv();
  const after = await refreshCapabilities(env, { now: Date.parse("2026-11-16T00:00:00Z"), fetchImpl: recovered });
  assert.equal(after.manifest.alerts.find((alert) => alert.id === "retirement:hailuo-standard").firstSeenAt, result.manifest.checkedAt);
});

test("an unrelated or wrong-model Cloudflare 200 cannot advance last good", async () => {
  const { env, fetchImpl } = refreshEnv();
  const first = await refreshCapabilities(env, { now: Date.parse("2026-11-15T00:00:00Z"), fetchImpl });
  assert.equal(first.state.outcome, "complete");
  const lastGoodAt = first.manifest.lastGoodAt;
  const badFetch = async (url) => {
    if (String(url).includes("flux-2-klein-9b")) {
      return new Response("# another model\n\nModel ID: another-model\n\n| Unit Pricing | $9 |\n");
    }
    return fetchImpl(url);
  };
  const second = await refreshCapabilities(env, { now: Date.parse("2026-11-16T00:00:00Z"), fetchImpl: badFetch });
  assert.equal(second.state.outcome, "partial");
  assert.equal(second.manifest.lastGoodAt, lastGoodAt);
  assert.ok(second.manifest.alerts.some((alert) => alert.id === "schema:studio-craft:cloudflare-workers-ai"));
});

test("pricing A to B to B carries the unresolved comparison", async () => {
  const { env, fetchImpl, setPrice } = refreshEnv();
  await refreshCapabilities(env, { now: Date.parse("2026-11-15T00:00:00Z"), fetchImpl });
  setPrice("$2");
  const run2 = await refreshCapabilities(env, { now: Date.parse("2026-11-16T00:00:00Z"), fetchImpl });
  const pricing2 = run2.manifest.alerts.find((alert) => alert.id === "pricing:studio-craft");
  assert.ok(pricing2);
  assert.equal(pricing2.previous, "$1");
  assert.equal(pricing2.current, "$2");
  const firstSeen = pricing2.firstSeenAt;
  const run3 = await refreshCapabilities(env, { now: Date.parse("2026-11-17T00:00:00Z"), fetchImpl });
  const pricing3 = run3.manifest.alerts.find((alert) => alert.id === "pricing:studio-craft");
  assert.ok(pricing3);
  assert.equal(pricing3.previous, "$1");
  assert.equal(pricing3.current, "$2");
  assert.equal(pricing3.firstSeenAt, firstSeen);
});

test("a partial refresh retains facts and unresolved pricing through recovery", async () => {
  const { env, fetchImpl, setPrice } = refreshEnv();
  await refreshCapabilities(env, { now: Date.parse("2026-11-15T00:00:00Z"), fetchImpl });
  setPrice("$2");
  const change = await refreshCapabilities(env, { now: Date.parse("2026-11-16T00:00:00Z"), fetchImpl });
  const partialEnv = refreshEnv({ fail: true });
  partialEnv.setPrice("$2");
  const partial = await refreshCapabilities(env, { now: Date.parse("2026-11-17T00:00:00Z"), fetchImpl: partialEnv.fetchImpl });
  assert.equal(partial.state.outcome, "partial");
  const partialSource = partial.manifest.sources.find((item) => item.model === "studio-craft" && item.provider === "cloudflare-workers-ai");
  assert.equal(partialSource.status, "unavailable");
  assert.equal(partialSource.pricing, "$2");
  assert.equal(partialSource.factsCheckedAt, change.manifest.checkedAt);
  const recovered = await refreshCapabilities(env, { now: Date.parse("2026-11-18T00:00:00Z"), fetchImpl });
  assert.equal(recovered.state.outcome, "complete");
  assert.equal(recovered.manifest.alerts.find((alert) => alert.id === "pricing:studio-craft").firstSeenAt, change.manifest.checkedAt);
  assert.ok(!recovered.manifest.alerts.some((alert) => alert.kind === "schema"));
});

test("the public manifest consumer sees retained facts and alerts", async () => {
  const { env, fetchImpl, setPrice } = refreshEnv();
  await refreshCapabilities(env, { now: Date.parse("2026-11-15T00:00:00Z"), fetchImpl });
  setPrice("$2");
  await refreshCapabilities(env, { now: Date.parse("2026-11-16T00:00:00Z"), fetchImpl });
  const response = await publicDiagnosticsResponse("/capabilities.json", env, {});
  const manifest = await response.json();
  assert.equal(response.status, 200);
  assert.equal(manifest.lastGoodAt, "2026-11-16T00:00:00.000Z");
  assert.ok(manifest.sources.some((item) => item.model === "studio-craft"));
  assert.ok(manifest.alerts.some((alert) => alert.id === "pricing:studio-craft" && alert.current === "$2"));
});

test("pricing returns to the reviewed baseline and resolves", async () => {
  const { env, fetchImpl, setPrice } = refreshEnv();
  await refreshCapabilities(env, { now: Date.parse("2026-11-15T00:00:00Z"), fetchImpl });
  setPrice("$2");
  const changed = await refreshCapabilities(env, { now: Date.parse("2026-11-16T00:00:00Z"), fetchImpl });
  assert.ok(changed.manifest.alerts.some((alert) => alert.id === "pricing:studio-craft"));
  setPrice("$1");
  const resolved = await refreshCapabilities(env, { now: Date.parse("2026-11-17T00:00:00Z"), fetchImpl });
  assert.ok(!resolved.manifest.alerts.some((alert) => alert.id === "pricing:studio-craft"));
});
