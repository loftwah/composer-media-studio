// MIT. Focused regression for #372: every SQL statement the read-only inventory
// prepares must parse under D1's remote expression-depth cap of 100. The local
// D1 stand-in uses SQLite's default cap (1000), so it cannot catch this on its
// own; the CLI's `.limit EXPR_DEPTH 100` reproduces the production failure.
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";

import { inventory } from "../src/lib/publication-policy.mjs";
import { migrations } from "./harness.mjs";

function sqlite3(args, input) {
  return spawnSync("sqlite3", args, { encoding: "utf8", input });
}

test("inventory statements stay within D1's expression-depth limit of 100", async (t) => {
  const probe = sqlite3(["--version"]);
  if (probe.error || probe.status !== 0) return t.skip("sqlite3 CLI unavailable");
  const supportsLimit = sqlite3([":memory:"], ".limit EXPR_DEPTH 100");
  if (supportsLimit.status !== 0 || /unknown command/i.test(supportsLimit.stderr)) return t.skip("sqlite3 CLI lacks .limit");

  // Capture the exact SQL the inventory prepares, with no live data needed.
  const captured = [];
  const db = {
    prepare(sql) {
      captured.push(sql);
      const statement = { first: async () => null, all: async () => ({ results: [] }) };
      return { ...statement, bind: () => statement };
    },
  };
  await inventory({ DB: db, MEDIA: { head: async () => null } }, "prj_depth");
  assert.ok(captured.length > 0, "inventory prepared at least one statement");
  for (const [index, sql] of captured.entries()) {
    const result = sqlite3([":memory:", "-bail"], `${migrations}\n.limit EXPR_DEPTH 100\n${sql};\n`);
    assert.equal(result.status, 0, `statement ${index + 1} failed under depth 100: ${result.stderr}`);
  }
});
