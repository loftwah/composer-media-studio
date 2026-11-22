// MIT. Focused regression checks for the strict TypeScript util conversion.
// util.mjs is now a shim over util.ts, so these pin the preserved invariants
// the worker and jobs engine rely on: one HttpError class identity across every
// import path, exact public HTTP errors and headers, null default semantics,
// string escaping, byte boundaries for sliced views and equal-string behavior.

import { test } from "node:test";
import assert from "node:assert/strict";

import * as util from "../src/lib/util.mjs";
import { HttpError } from "../src/lib/util.mjs";

test("the shim keeps one HttpError class identity across import paths", async () => {
  const direct = await import("../src/lib/util.ts");
  assert.equal(HttpError, direct.HttpError);
  assert.equal(util.HttpError, HttpError);
  const error = new HttpError(404, "Not found", "not_found");
  assert.ok(error instanceof HttpError);
  assert.ok(error instanceof Error);
  assert.equal(error.status, 404);
  assert.equal(error.code, "not_found");
  assert.equal(new HttpError(400, "Bad").code, "invalid_request");
});

test("json sets the exact public headers and problem keeps the error shape", async () => {
  const response = util.json({ ok: true }, 201, { "content-type": "text/custom" });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("content-type"), "text/custom");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(util.json({}).status, 200);
  const problem = util.problem("Nope", 409, "conflict");
  assert.equal(problem.status, 409);
  assert.equal(problem.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(await problem.json(), { error: { code: "conflict", message: "Nope" } });
  assert.equal(util.problem("Bad").status, 400);
  assert.deepEqual(await (await util.problem("Bad")).json(), {
    error: { code: "invalid_request", message: "Bad" },
  });
});

test("safeJson falls back for null results and unparseable input", () => {
  const fallback = { kept: true };
  assert.equal(util.safeJson("null", fallback), fallback);
  assert.equal(util.safeJson("undefined", fallback), fallback);
  assert.equal(util.safeJson("{nope", fallback), fallback);
  assert.equal(util.safeJson("", fallback), fallback);
  assert.deepEqual(util.safeJson('{"a":1}', fallback), { a: 1 });
  assert.equal(util.safeJson('"kept"', "other"), "kept");
});

test("escapeHtml keeps the exact five entities and stringifies the rest", () => {
  assert.equal(util.escapeHtml('&<>"\''), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(util.escapeHtml(undefined), "");
  assert.equal(util.escapeHtml(null), "");
  assert.equal(util.escapeHtml(7), "7");
});

test("sha256Hex hashes exactly the viewed bytes of a sliced Uint8Array", async () => {
  const whole = crypto.getRandomValues(new Uint8Array(12));
  const slice = whole.subarray(4, 8);
  const standalone = new Uint8Array(slice);
  assert.equal(await util.sha256Hex(slice), await util.sha256Hex(standalone));
  assert.notEqual(await util.sha256Hex(slice), await util.sha256Hex(whole));
});

test("constantTimeEqual and timingSafeEqualString keep equal-string behavior", () => {
  assert.equal(util.constantTimeEqual("same", "same"), true);
  assert.equal(util.constantTimeEqual("same", "sane"), false);
  assert.equal(util.constantTimeEqual("same", "sam"), false);
  assert.equal(util.timingSafeEqualString("same", "same"), true);
  assert.equal(util.timingSafeEqualString(1, "1"), false);
  assert.equal(util.timingSafeEqualString(undefined, "same"), false);
});
