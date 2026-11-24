import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const command = fileURLToPath(new URL("../scripts/local-gif.mjs", import.meta.url));
const sources = ["--source", "first.png", "--source", "second.png"];
const operation = ["--frame-size", "160", "--delay", "350"];

function refusal(args, message) {
  assert.throws(() => execFileSync(process.execPath, [command, ...args], { stdio: "pipe" }), error =>
    error.status === 1 && message.test(error.stderr.toString()) && error.stdout.length === 0);
}

test("GIF command validates frame count, size, delay, matte, playback and output before opening files", () => {
  const target = ["--output", "unused.gif"];
  refusal([...sources.slice(0, 2), ...operation, ...target], /2–8 explicit/);
  refusal([...Array(9).fill(sources.slice(0, 2)).flat(), ...operation, ...target], /2–8 explicit/);
  refusal([...sources, "--frame-size", "161", "--delay", "350", ...target], /--frame-size/);
  refusal([...sources, "--frame-size", "160", "--delay", "355", ...target], /10 ms steps/);
  refusal([...sources, ...operation, ...target, "--matte", "#fff"], /six-digit hex colour/);
  refusal([...sources, ...operation, ...target, "--once", "--loop"], /Do not combine/);
  refusal([...sources, ...operation, "--output", "unused.png"], /path ending in .gif/);
});

test("GIF command refuses to overwrite an existing output before opening files", () => {
  const root = mkdtempSync(join(tmpdir(), "studio-local-gif-test-"));
  try {
    const path = join(root, "already.gif");
    writeFileSync(path, "previous output");
    refusal([...sources, ...operation, "--output", path], /output path already exists/);
    assert.equal(readFileSync(path, "utf8"), "previous output");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("GIF command validates the optional full ordered per-frame delay vector before opening files", () => {
  const target = ["--output", "unused.gif"];
  refusal([...sources, ...operation, "--frame-delays-ms", "350", ...target], /exactly 2/);
  refusal([...sources, ...operation, "--frame-delays-ms", "350,355", ...target], /10 ms steps/);
  refusal([...sources, ...operation, "--frame-delays-ms", "90,350", ...target], /100 to 2000/);
  refusal([...sources, ...operation, "--frame-delays-ms", "350,,500", ...target], /whole milliseconds/);
});
