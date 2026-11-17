import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyLiveRelease } from "../scripts/live-release.mjs";

const expected = "a".repeat(40);
const stale = "b".repeat(40);
const response = (revision, status = 200) => ({ ok: status === 200, status, json: async () => ({ revision }) });

test("waits for both endpoints to report the exact released revision", async () => {
  let calls = 0, sleeps = 0;
  await verifyLiveRelease({ origin: "https://example.test", expected, attempts: 3, sleep: async () => { sleeps++; }, fetchImpl: async (url) => {
    calls++;
    assert.match(url, /\/(healthz|build\.json)$/);
    return response(calls <= 2 || (calls === 4) ? stale : expected);
  }});
  assert.equal(calls, 6);
  assert.equal(sleeps, 2);
});

test("an immediate exact match returns after the first reads with no sleep", async () => {
  let calls = 0, sleeps = 0;
  await verifyLiveRelease({ origin: "https://example.test", expected, sleep: async () => { sleeps++; }, fetchImpl: async () => {
    calls++;
    return response(expected);
  }});
  assert.equal(calls, 2, "both primary endpoints were read once");
  assert.equal(sleeps, 0, "success exits immediately without waiting");
});

test("the bounded default window catches the observed ~45s delayed rollout", async () => {
  const rolloutAtMs = 45_000;
  let clockMs = 0, reads = 0, sleeps = 0;
  await verifyLiveRelease({
    origin: "https://example.test",
    expected,
    sleep: async (ms) => { sleeps++; clockMs += ms; },
    fetchImpl: async () => {
      reads++;
      return response(clockMs >= rolloutAtMs ? expected : stale);
    },
  });
  assert.ok(clockMs >= rolloutAtMs, `polled until the exact revision appeared (waited ${clockMs}ms)`);
  assert.ok(sleeps >= 1 && clockMs <= 55_000, "resolved before the window was exhausted");
  assert.equal(reads, 2 * (sleeps + 1), "both endpoints were read on every attempt");
});

test("one fresh endpoint is not enough; both must report the exact revision", async () => {
  let calls = 0;
  await assert.rejects(verifyLiveRelease({ origin: "https://example.test", expected, attempts: 3, sleep: async () => {}, fetchImpl: async (url) => {
    calls++;
    return response(url.endsWith("/healthz") ? expected : stale);
  } }), /live source did not match.*after 3 attempts/);
  assert.equal(calls, 6, "kept polling because /build.json stayed stale");
});

test("the bounded window is finite and refuses with a nonzero outcome on exhaustion", async () => {
  let clockMs = 0, reads = 0, sleeps = 0;
  await assert.rejects(
    verifyLiveRelease({
      origin: "https://example.test",
      expected,
      sleep: async (ms) => { sleeps++; clockMs += ms; },
      fetchImpl: async () => { reads++; return response(stale); },
    }),
    /after 12 attempts/,
  );
  assert.equal(reads, 24, "both endpoints read on each bounded attempt");
  assert.equal(sleeps, 11, "no sleep after the final refusal");
  assert.equal(clockMs, 55_000);
});

test("fails closed when the live revision stays different", async () => {
  let calls = 0;
  await assert.rejects(verifyLiveRelease({ origin: "https://example.test", expected, attempts: 3, sleep: async () => {}, fetchImpl: async () => { calls++; return response(stale); } }), /live source did not match.*after 3 attempts/);
  assert.equal(calls, 6);
});

test("retries transient HTTP and network errors but never accepts a failed endpoint", async () => {
  let calls = 0;
  await assert.rejects(verifyLiveRelease({ origin: "https://example.test", expected, attempts: 2, sleep: async () => {}, fetchImpl: async () => { calls++; if (calls === 1) throw Error("network"); return response(expected, 503); } }), /HTTP 503/);
  assert.equal(calls, 4);
});
