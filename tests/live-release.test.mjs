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
