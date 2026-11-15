// MIT. The model chooser's contract: only like jobs are compared, a charge is
// never invented from an allocation, and a verdict refuses to crown a winner it
// cannot support.
import test from "node:test";
import assert from "node:assert/strict";
import {
  JOB_GROUPS,
  costSummary,
  jobCatalogue,
  latestPerModel,
  money,
  verdict,
  weakness,
} from "../src/lib/comparisons.mjs";

const models = {
  "still-a": { id: "still-a", label: "Still A", kind: "image", references: 0, costMicro: 1000, costBasis: "estimate" },
  "still-b": { id: "still-b", label: "Still B", kind: "image", references: 0, costMicro: 2000, costBasis: "estimate" },
  "detail-a": { id: "detail-a", label: "Detail A", kind: "image", references: 1, costMicro: 500, costBasis: "estimate" },
  "motion-a": { id: "motion-a", label: "Motion A", kind: "video", references: 1, costMicro: 30_000, costBasis: "estimate" },
  "motion-b": { id: "motion-b", label: "Motion B", kind: "video", references: 1, costMicro: 40_000, costBasis: "estimate" },
  "edit-a": { id: "edit-a", label: "Fill A", kind: "image", edit: "fill", references: 1, costMicro: 20_000, costBasis: "estimate" },
  "voice-a": { id: "voice-a", label: "Voice A", kind: "audio", audio: { mode: "speech" }, references: 0, costMicro: 60_000, costBasis: "estimate" },
  "music-a": { id: "music-a", label: "Music A", kind: "audio", audio: { mode: "music" }, references: 0, costMicro: 15_000, costBasis: "estimate" },
  "fx-a": { id: "fx-a", label: "Effect A", kind: "audio", audio: { mode: "effect" }, references: 0, costMicro: 8_000, costBasis: "estimate" },
  "restyle-a": { id: "restyle-a", label: "Restyle A", kind: "video", restyle: true, references: 0, costMicro: 168_000, costBasis: "estimate" },
};

test('every job in the catalogue comes from a declared group', () => {
  const catalogue = jobCatalogue(models);
  assert.equal(catalogue.length, JOB_GROUPS.length);
  for (const job of catalogue) {
    assert.ok(job.label && job.purpose && job.settings);
    assert.equal(job.comparable, job.models.length >= 2);
    if (!job.comparable) assert.ok(job.note, `${job.id} must say why it cannot compare yet`);
  }
});

test('a job is comparable only when two served models can do it', () => {
  const catalogue = jobCatalogue(models);
  const still = catalogue.find((job) => job.id === "still");
  assert.equal(still.comparable, true);
  assert.deepEqual(still.models.map((model) => model.id).sort(), ["still-a", "still-b"]);
  const voice = catalogue.find((job) => job.id === "voice");
  assert.equal(voice.comparable, false);
  assert.match(voice.note, /nothing to compare/);
});

test('a reference-guided variation never borrows a plain still model', () => {
  const job = jobCatalogue(models).find((entry) => entry.id === "reference-edit");
  assert.deepEqual(job.models.map((model) => model.id), ["detail-a"]);
});

test('motion excludes assembly renders and restyles', () => {
  const job = jobCatalogue(models).find((entry) => entry.id === "motion");
  assert.deepEqual(job.models.map((model) => model.id).sort(), ["motion-a", "motion-b"]);
});

test('only the newest saved take per model is used', () => {
  const rows = [
    { model: "motion-a", id: "newest", kind: "video", asset_id: "a1", request_json: '{"prompt":"later"}' },
    { model: "motion-b", id: "b1", kind: "video", asset_id: "b1" },
    { model: "motion-a", id: "older", kind: "video", asset_id: "a0" },
  ];
  const entries = latestPerModel(rows, "motion");
  assert.deepEqual(entries.map((entry) => entry.generationId), ["newest", "b1"]);
  assert.equal(entries[0].prompt, "later");
});

test('an unknown charge stays null instead of becoming zero', () => {
  const summary = costSummary([
    { cost: { estimateMicro: 1000, allocatedMicro: 900, providerChargedMicro: null } },
    { cost: { estimateMicro: 2000, allocatedMicro: 1800, providerChargedMicro: null } },
  ]);
  assert.equal(summary.allocatedMicro, 2700);
  assert.equal(summary.providerChargedMicro, null);
  assert.equal(summary.providerChargedTakes, 0);
  assert.equal(money(summary.providerChargedMicro), "unknown");
  assert.equal(summary.perTakeAllocatedMicro, 1350);
});

test('a reported provider charge is kept separate from the allocation', () => {
  const summary = costSummary([
    { cost: { estimateMicro: 1000, allocatedMicro: 900, providerChargedMicro: 1200 } },
    { cost: { estimateMicro: 1000, allocatedMicro: 900, providerChargedMicro: null } },
  ]);
  assert.equal(summary.allocatedMicro, 1800);
  assert.equal(summary.providerChargedMicro, 1200);
  assert.equal(summary.providerChargedTakes, 1, 'one of two takes reported a charge');
});

test('the verdict says there is nothing to compare when no take is saved', () => {
  const result = verdict({ entries: [], job: { label: "Motion", comparable: true } });
  assert.match(result.headline, /Nothing saved/);
  assert.equal(result.lead, null);
});

test('one take is a record, not a comparison', () => {
  const result = verdict({
    entries: [{ model: "voice-a", cost: { estimateMicro: 1, allocatedMicro: 1, providerChargedMicro: null } }],
    job: { label: "Voice", comparable: false },
  });
  assert.match(result.headline, /no comparison/i);
  assert.equal(result.lead, null);
});

test('an owner pick leads the verdict and is quoted', () => {
  const entries = [
    { model: "motion-a", cost: { estimateMicro: 30_000, allocatedMicro: 30_000, providerChargedMicro: null } },
    { model: "motion-b", cost: { estimateMicro: 40_000, allocatedMicro: 40_000, providerChargedMicro: null } },
  ];
  const result = verdict({
    entries,
    models,
    job: { label: "Motion", comparable: true },
    votes: { "motion-b": { choice: true, reason: "The hands stay still", at: "0:04" } },
  });
  assert.match(result.headline, /You chose Motion B/);
  assert.match(result.detail, /The hands stay still/);
  assert.equal(result.lead, "motion-b");
});

test('without a pick the verdict only claims what the numbers support', () => {
  const entries = [
    { model: "motion-a", cost: { estimateMicro: 30_000, allocatedMicro: 30_000, providerChargedMicro: null } },
    { model: "motion-b", cost: { estimateMicro: 40_000, allocatedMicro: 40_000, providerChargedMicro: null } },
  ];
  const result = verdict({ entries, models, job: { label: "Motion", comparable: true }, votes: {} });
  assert.equal(result.basis, "cost");
  assert.match(result.detail, /Cost is the only measured difference/);
});

test('identical allocations do not invent a winner', () => {
  const entries = [
    { model: "still-a", cost: { estimateMicro: 1000, allocatedMicro: 1000, providerChargedMicro: null } },
    { model: "still-b", cost: { estimateMicro: 1000, allocatedMicro: 1000, providerChargedMicro: null } },
  ];
  const result = verdict({ entries, models, job: { label: "A still image", comparable: true }, votes: {} });
  assert.equal(result.lead, null);
  assert.match(result.detail, /Nothing in the recorded numbers separates them/);
});

test('a rejected take becomes one routed weakness with the owner named', () => {
  const result = weakness({
    entries: [{ model: "motion-b", generationId: "g2", cost: { providerChargedMicro: null } }],
    votes: { "motion-b": { choice: false, reason: "The second hand melts at 0:04" } },
  });
  assert.equal(result.model, "motion-b");
  assert.match(result.reason, /melts/);
  assert.ok(result.owner);
  assert.ok(result.next);
});

test('a missing provider charge is itself the reported weakness', () => {
  const result = weakness({
    entries: [{ model: "motion-a", generationId: "g1", cost: { providerChargedMicro: null } }],
    votes: {},
  });
  assert.equal(result.model, null);
  assert.match(result.reason, /provider-reported charge/);
});

test('a comparison with a reported charge has no charge weakness', () => {
  const result = weakness({
    entries: [{ model: "motion-a", generationId: "g1", cost: { providerChargedMicro: 1200 } }],
    votes: {},
  });
  assert.equal(result, null);
});

test('takes made from different briefs are not presented as a comparison', async () => {
  const { likeForLike } = await import("../src/lib/comparisons.mjs");
  const split = likeForLike([
    { model: "motion-a", briefKey: "aaaa1111", prompt: "slow push in", settings: { aspect: "from-image", durationSeconds: 6 } },
    { model: "motion-b", briefKey: "bbbb2222", prompt: "gentle parallax left", settings: { aspect: "from-image", durationSeconds: 6 } },
  ]);
  assert.equal(split.likeForLike, false);
  assert.equal(split.chosen.length, 1);
  assert.equal(split.excluded.length, 1);
  assert.match(split.reason, /not generated from the same brief/);
});

test('the largest like-for-like group becomes the comparison', async () => {
  const { likeForLike } = await import("../src/lib/comparisons.mjs");
  const split = likeForLike([
    { model: "a", briefKey: "same" },
    { model: "b", briefKey: "same" },
    { model: "c", briefKey: "other" },
  ]);
  assert.equal(split.likeForLike, true);
  assert.deepEqual(split.chosen.map((entry) => entry.model), ["a", "b"]);
  assert.deepEqual(split.excluded.map((entry) => entry.model), ["c"]);
});

test('a brief fingerprint ignores case and spacing but not settings', async () => {
  const { toEntry } = await import("../src/lib/comparisons.mjs");
  const one = toEntry({ id: "g1", model: "m", kind: "video", request_json: '{"prompt":"Slow  push IN","durationSeconds":6}' }, "motion");
  const two = toEntry({ id: "g2", model: "m", kind: "video", request_json: '{"prompt":"slow push in","durationSeconds":6}' }, "motion");
  const three = toEntry({ id: "g3", model: "m", kind: "video", request_json: '{"prompt":"slow push in","durationSeconds":10}' }, "motion");
  assert.equal(one.briefKey, two.briefKey);
  assert.notEqual(one.briefKey, three.briefKey);
  assert.equal(three.settings.durationSeconds, 10);
});

test('a review is bound to the exact saved take, not just the model name', async () => {
  const { comparePage } = await import("../src/lib/ui.mjs");
  const html = comparePage({
    revision: "test",
    job: { id: "motion", label: "Motion from a still", purpose: "Animate a still.", settings: "Same still, same length.", models: [] },
    entries: [
      {
        model: "h3",
        generationId: "gen_a",
        briefKey: "brief_a",
        createdAt: 1,
        kind: "video",
        previewUrl: null,
        prompt: "slow push in",
        settings: { aspect: "from-image", durationSeconds: 5, reference: "asset_ref" },
        cost: { estimateMicro: 240000, allocatedMicro: 240000, providerChargedMicro: null },
      },
    ],
    models: { h3: { label: "H3 Max Turbo" } },
  });
  assert.match(html, /data-generation="gen_a"/);
  assert.match(html, /data-brief="brief_a"/);
  assert.match(html, /bound to the exact saved take/);
  assert.match(html, /\/api\/assets\/asset_ref\/file/);
  assert.match(html, /Source still used for this take/);
});
