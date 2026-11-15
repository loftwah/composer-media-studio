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
} from "../src/lib/capabilities.mjs";
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
  const alerts = buildAlerts([source], [
    { ...source, pricing: "$1", alertFirstSeenAt: "2026-11-14T00:00:00.000Z" },
    { ...source, pricing: "$1", alertFirstSeenAt: "2026-11-14T00:00:00.000Z" },
  ]);
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
});

function refreshEnv({ fail = false } = {}) {
  const bucket = new FakeBucket();
  const env = { MEDIA: bucket, AI: { run() { throw new Error("Inference must not run during refresh"); } } };
  let prices = "$1";
  const fetchImpl = async (url) => {
    if (fail && String(url).includes("flux-2-klein-9b")) throw new Error("network down");
    if (String(url).startsWith("https://models.dev/")) return new Response(JSON.stringify({ openai: {}, anthropic: {} }));
    if (String(url).startsWith("https://fal.ai/api/models")) {
      const endpoint = decodeURIComponent(new URL(url).searchParams.get("keywords"));
      return new Response(JSON.stringify({ items: [{ id: endpoint, deprecated: false, removed: false, status: "public", pricingInfoOverride: prices }] }));
    }
    if (String(url).includes("/workers-ai/models/")) {
      return new Response("# model\n\n| Unit Pricing | " + prices + " |\n");
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
