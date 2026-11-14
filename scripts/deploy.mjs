#!/usr/bin/env node
// MIT. Guarded release for the independent Media Studio.
// Only a clean, pushed main may upload. Checks run once, then one deploy, then
// the live source identity is read back.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { verifyLiveRelease } from "./live-release.mjs";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const migrate = args.has("--migrate");

function run(command, options = {}) {
  return execFileSync(command[0], command.slice(1), {
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    env: process.env,
  });
}

function fail(message) {
  console.error(`\nrelease refused: ${message}\n`);
  process.exit(1);
}

const status = run(["git", "status", "--porcelain"], { capture: true }).trim();
if (status) fail(`working tree is not clean:\n${status}`);

const branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { capture: true }).trim();
if (branch !== "main") fail(`release runs from main, not ${branch}`);

run(["git", "fetch", "origin", "main", "--quiet"]);
const head = run(["git", "rev-parse", "HEAD"], { capture: true }).trim();
const origin = run(["git", "rev-parse", "origin/main"], { capture: true }).trim();
if (head !== origin) fail("main is not pushed; push the reviewed commit first");

const manifest = JSON.parse(readFileSync(new URL("../app.manifest.json", import.meta.url), "utf8"));
const originRepository = run(["git", "remote", "get-url", "origin"], { capture: true })
  .trim()
  .replace(/^git@github\.com:/, "https://github.com/")
  .replace(/\.git$/, "");
if (manifest.repository !== originRepository)
  fail(
    `manifest repository ${manifest.repository} does not match this copy's origin ${originRepository}; set app.manifest.json to the repository this owner controls`,
  );

console.log(`checking ${head.slice(0, 12)}…`);
run(["pnpm", "check"]);
// `check` already runs TypeScript against this exact clean source revision.
// Build directly so the release does not repeat the same typecheck.
run(["pnpm", "exec", "vite", "build"]);

if (dryRun) {
  console.log("dry run: checks passed; nothing uploaded");
  process.exit(0);
}

if (migrate) {
  console.log("applying remote D1 migrations…");
  run(["npx", "wrangler", "d1", "migrations", "apply", "media-studio", "--remote"]);
}

const builtAt = new Date().toISOString();
run([
  "npx",
  "wrangler",
  "deploy",
  "--define",
  `__BUILD_REVISION__:${JSON.stringify(head)}`,
  "--define",
  `__BUILD_TIME__:${JSON.stringify(builtAt)}`,
]);

const wranglerSource = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const wranglerConfig = JSON.parse(wranglerSource);
const originUrl = String(process.env.PUBLIC_ORIGIN ?? wranglerConfig.vars.PUBLIC_ORIGIN).replace(/\/$/, "");
if (!originUrl.startsWith("https://")) fail("PUBLIC_ORIGIN must be an HTTPS origin");
try {
  await verifyLiveRelease({ origin: originUrl, expected: head });
} catch (error) {
  fail(error.message);
}

console.log(`released ${head.slice(0, 12)} at ${builtAt}`);
console.log(`live: ${originUrl}/healthz`);
