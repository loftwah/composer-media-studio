// MIT. Shared test harness: the real migration SQL, an in-memory D1 stand-in
// and an R2 stand-in. No network, no provider key, no production binding.

import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migrationsDir = new URL("../migrations/", import.meta.url);
export const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(new URL(name, migrationsDir), "utf8"))
  .join("\n");

export class SqliteD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec(migrations);
  }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    return {
      bind: (...args) => ({
        _batchRun: () => statement.run(...args),
        first: async () => statement.get(...args) ?? null,
        all: async () => ({ results: statement.all(...args) }),
        run: async () => statement.run(...args),
      }),
      first: async () => statement.get() ?? null,
      all: async () => ({ results: statement.all() }),
      run: async () => statement.run(),
    };
  }
  async batch(statements) {
    this.db.exec("BEGIN");
    try {
      const results = statements.map(statement => ({ meta: { changes: Number(statement._batchRun().changes) } }));
      this.db.exec("COMMIT");
      return results;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  exec(sql) {
    this.db.exec(sql);
  }
}

export class FakeBucket {
  constructor() {
    this.objects = new Map();
    this.meta = new Map();
    this.puts = [];
  }
  async put(key, bytes, options = {}) {
    // A conditional write (Darkroom's immutable output) refuses an existing key.
    if (options.onlyIf && this.objects.has(key)) return null;
    this.objects.set(key, new Uint8Array(bytes));
    this.meta.set(key, { httpMetadata: options.httpMetadata, customMetadata: options.customMetadata });
    this.puts.push(key);
    return { version: `v${this.puts.length}` };
  }
  async get(key) {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return {
      key,
      version: "v",
      size: bytes.byteLength,
      ...this.meta.get(key),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  }
  async head(key) {
    const bytes = this.objects.get(key);
    return bytes ? { key, version: "v", size: bytes.byteLength, ...this.meta.get(key) } : null;
  }
  async delete(key) {
    this.objects.delete(key);
  }
}

export const PNG_1x1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

export function jpeg(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  bytes.set([0xff, 0xd9], 22);
  return bytes;
}

/** A mono 8 kHz WAV whose declared data length and byte rate are checked. */
export function wav({ seconds = 2, sampleRate = 8000, channels = 1, bits = 16 } = {}) {
  const blockAlign = (channels * bits) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = Math.round(byteRate * seconds);
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const ascii = (offset, value) => bytes.set([...Buffer.from(value)], offset);
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true);
  ascii(36, "data");
  view.setUint32(40, dataSize, true);
  return bytes;
}

/** One MPEG-1 Layer III frame header, 128 kbps at 44.1 kHz, stereo. */
export function mp3FrameHeader() {
  return Uint8Array.from([0xff, 0xfb, 0x90, 0x00]);
}

export async function setup({ allowance = 5_000_000, projectId = "prj_test" } = {}) {
  const env = {
    DB: new SqliteD1(),
    MEDIA: new FakeBucket(),
    MONTHLY_ALLOWANCE_MICRO: allowance,
    PUBLIC_ORIGIN: "https://studio.test",
    SESSION_SECRET: "test-session-secret-that-is-long-enough",
  };
  const timestamp = Date.now();
  await env.DB.prepare(
    "INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES(?1,?2,?3,'','private','{}',?4,?4)",
  )
    .bind(projectId, "Test studio", `slug-${projectId}`, timestamp)
    .run();
  const project = await env.DB.prepare("SELECT * FROM projects WHERE id=?1").bind(projectId).first();
  return { env, project };
}

export async function addAsset(env, project, { id, kind, durationMs = null, source = "upload", r2Key = `k-${id}` }) {
  await env.DB.prepare(
    "INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,duration_ms,sha256,title,caption,source,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,10,1280,720,?6,'hash',?7,'',?8,1,1)",
  )
    .bind(id, project.id, kind, r2Key, kind === "audio" ? "audio/mpeg" : "video/mp4", durationMs, `Asset ${id}`, source)
    .run();
  return env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(id).first();
}
