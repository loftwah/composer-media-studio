#!/usr/bin/env node
// MIT. Guarded release for the independent Media Studio.
// Only a clean, pushed main may upload. Checks run once, then one deploy, then
// the live source identity is read back.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { verifyLiveRelease } from "./live-release.mjs";
import {
  createGitHubAdapter,
  createReleaseRun,
} from "./lib/release-timing.mjs";

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

let github = null;
try {
  github = createGitHubAdapter({ repo: "loftwah/composer-media-studio" });
} catch (error) {
  console.error(
    "Delivery SLA alert reporting is unavailable; a redacted pending event will be queued. " +
      error.message,
  );
}
const wranglerSource = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const wranglerConfig = JSON.parse(wranglerSource);
const originUrl = String(process.env.PUBLIC_ORIGIN ?? wranglerConfig.vars.PUBLIC_ORIGIN).replace(/\/$/, "");
if (!originUrl.startsWith("https://")) fail("PUBLIC_ORIGIN must be an HTTPS origin");

const release = createReleaseRun({
  repo: "loftwah/composer-media-studio",
  project: "composer-media-studio",
  sha: head,
  releasePath: "scripts/deploy.mjs",
  kind: "worker-production",
  receiptDir: ".release/timing",
  github,
});
await release.flushPending();
const stage = async (name, work) => {
  const started = performance.now();
  const result = await release.stage(name, work);
  console.log(`Release gate passed: ${name} (${((performance.now() - started) / 1000).toFixed(1)}s)`);
  return result;
};

try {
console.log(`checking ${head.slice(0, 12)}…`);
await stage("required checks (pnpm check)", () => run(["pnpm", "check"]));
// `check` already runs TypeScript against this exact clean source revision.
// Build directly so the release does not repeat the same typecheck.
await stage("frontend production build", () => run(["pnpm", "exec", "vite", "build"]));

if (dryRun) {
  const receipt = await release.finish({
    status: "incomplete",
    target: originUrl,
    reason: "dry run: qualified locally, nothing uploaded",
  });
  console.log(
    `dry run: checks passed; nothing uploaded. ${receipt.status} after ${(receipt.totalMs / 1000).toFixed(1)}s.`,
  );
  process.exit(0);
}

if (migrate) {
  console.log("applying remote D1 migrations…");
  await stage("remote D1 migrations", () =>
    run(["npx", "wrangler", "d1", "migrations", "apply", "media-studio", "--remote"]),
  );
}

const builtAt = new Date().toISOString();
await stage("Worker upload", () =>
  run([
    "npx",
    "wrangler",
    "deploy",
    "--define",
    `__BUILD_REVISION__:${JSON.stringify(head)}`,
    "--define",
    `__BUILD_TIME__:${JSON.stringify(builtAt)}`,
  ]),
);

await stage("live exact source identity", () =>
  verifyLiveRelease({ origin: originUrl, expected: head }),
);

const receipt = await release.finish({
  status: "passed",
  target: originUrl,
  liveRevision: head,
});
console.log(`released ${head.slice(0, 12)} at ${builtAt}`);
console.log(`live: ${originUrl}/healthz`);
console.log(
  `release ${receipt.status}: ${(receipt.totalMs / 1000).toFixed(1)}s (target ${(receipt.targetMs / 1000).toFixed(0)}s, limit ${(receipt.limitMs / 1000).toFixed(0)}s)`,
);
} catch (error) {
  await release.fail(error);
  throw error;
}
