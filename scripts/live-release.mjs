// MIT. Read-only verification while a newly uploaded Worker propagates.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function verifyLiveRelease({ origin, expected, fetchImpl = fetch, sleep = wait, attempts = 8, intervalMs = 1000, requestTimeoutMs = 3000 }) {
  async function read(path) {
    try {
      const response = await fetchImpl(`${origin}${path}`, {
        headers: { "cache-control": "no-cache" },
        cache: "no-store",
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!response.ok) return `${path}: HTTP ${response.status}`;
      const payload = await response.json();
      if (payload?.revision === expected) return null;
      const revision = typeof payload?.revision === "string" && /^[a-f0-9]{7,64}$/i.test(payload.revision) ? payload.revision : "missing or invalid";
      return `${path}: revision ${revision}`;
    } catch {
      return `${path}: request failed or timed out`;
    }
  }

  let errors = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    errors = (await Promise.all([read("/healthz"), read("/build.json")])).filter(Boolean);
    if (!errors.length) return;
    if (attempt + 1 < attempts) await sleep(intervalMs);
  }
  throw new Error(`live source did not match ${expected} after ${attempts} attempts: ${errors.join("; ")}`);
}
