// MIT. Receive fal's completion webhook. The queue result route can be
// refused for an account while the request itself completes; a webhook is
// fal's documented way to hand us the finished payload. Every delivery is
// verified against fal's published Ed25519 keys, then saved through the same
// owned-storage path as a polled result.
//
// This is the strict TypeScript source. The installed DOM Web Crypto types
// describe the SHA-256 digest and Ed25519 verification below, while the
// delivery, JWKS and job seams name only the fields this handler reads. Every
// annotation is erased at runtime, so fal-webhook.mjs keeps the Worker and
// tests on their current import path with the same admission, signature,
// request scope, replay and callback behaviour.

import { completeFromWebhook, failFromWebhook, loadGenerationByProviderRequest } from "./jobs.mjs";
import { HttpError } from "./util.mjs";

const JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";
const MAX_SKEW_SECONDS = 300;
const CACHE_MS = 6 * 60 * 60 * 1000;

interface CachedSigningKeys {
  at: number;
  keys: string[];
}

/** The only part of fal's JWKS document this handler reads. */
interface SigningKeysBody {
  keys?: Array<{ x?: unknown }>;
}

/** The payload detail fields used for a provider error delivery. */
interface FalWebhookPayload {
  detail?: unknown;
  error_type?: unknown;
}

/** One delivery; JSON can omit or mistype any field, so all are unknown. */
interface FalWebhookDelivery {
  request_id?: unknown;
  gateway_request_id?: unknown;
  status?: unknown;
  error?: unknown;
  payload?: FalWebhookPayload | null;
}

/** The Worker env seam: the job lookup and callbacks arrive through it. */
export interface FalWebhookEnvironment {
  DB: unknown;
}

let cachedKeys: CachedSigningKeys = { at: 0, keys: [] };

function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function hexToBytes(value: string | null): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== "string" || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

async function signingKeys(): Promise<string[]> {
  if (cachedKeys.keys.length && Date.now() - cachedKeys.at < CACHE_MS) return cachedKeys.keys;
  const response = await fetch(JWKS_URL, { headers: { accept: "application/json" } });
  const body = (await response.json().catch(() => null)) as SigningKeysBody | null;
  const keys = (body?.keys ?? [])
    .map((key) => key?.x)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (!response.ok || !keys.length)
    throw new HttpError(503, "The provider's signing keys are unavailable", "webhook_keys_unavailable");
  cachedKeys = { at: Date.now(), keys };
  return keys;
}

async function verifyDelivery(request: Request, rawBody: Uint8Array<ArrayBuffer>): Promise<boolean> {
  const headers = request.headers;
  const requestId = headers.get("x-fal-webhook-request-id");
  const userId = headers.get("x-fal-webhook-user-id");
  const timestamp = headers.get("x-fal-webhook-timestamp");
  const signature = hexToBytes(headers.get("x-fal-webhook-signature"));
  if (!requestId || !userId || !timestamp || !signature) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > MAX_SKEW_SECONDS) return false;

  const digest = await crypto.subtle.digest("SHA-256", rawBody);
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const message = new TextEncoder().encode(`${requestId}\n${userId}\n${timestamp}\n${hex}`);

  for (const key of await signingKeys()) {
    try {
      const imported = await crypto.subtle.importKey(
        "raw",
        base64urlToBytes(key),
        { name: "Ed25519" },
        false,
        ["verify"],
      );
      if (await crypto.subtle.verify({ name: "Ed25519" }, imported, signature, message)) return true;
    } catch {
      // Try the next published key. An unsupported key type is not a pass.
    }
  }
  return false;
}

/** Public route: no session. Authenticity comes from fal's signature, and the
 * only writable effect is on the job that already holds this request id. */
export async function handleFalWebhook(request: Request, env: FalWebhookEnvironment): Promise<Response> {
  const rawBody = new Uint8Array(await request.arrayBuffer());
  let verified = false;
  try {
    verified = await verifyDelivery(request, rawBody);
  } catch {
    verified = false;
  }
  if (!verified)
    return new Response(JSON.stringify({ ok: false, error: "invalid_signature" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });

  let delivery: FalWebhookDelivery | null = null;
  try {
    delivery = JSON.parse(new TextDecoder().decode(rawBody)) as FalWebhookDelivery | null;
  } catch {
    delivery = null;
  }
  const requestId = delivery?.request_id ?? delivery?.gateway_request_id;
  if (!requestId)
    return new Response(JSON.stringify({ ok: true, ignored: "missing_request_id" }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });

  const generation = await loadGenerationByProviderRequest(env, String(requestId));
  if (!generation) {
    // Acknowledge unknown ids so fal does not retry a delivery we cannot match.
    return new Response(JSON.stringify({ ok: true, ignored: "unknown_request" }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const ok = delivery?.status === "OK";
  try {
    if (ok) await completeFromWebhook(env, generation, delivery?.payload ?? null);
    else
      await failFromWebhook(env, generation, {
        // fal's own sentence and the model's payload detail are both useful:
        // the first names the stage, the second names the rejected input.
        detail: [delivery?.error, delivery?.payload?.detail]
          .map((value) => (value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value)))
          .filter(Boolean)
          .join(" — "),
        errorType: delivery?.payload?.error_type ?? null,
      });
  } catch (error) {
    // A save failure must be retried by fal, so return a 5xx and keep the job.
    console.error(
      "fal webhook",
      generation.id,
      (error as { message?: unknown } | null | undefined)?.message ?? error,
    );
    return new Response(JSON.stringify({ ok: false, error: "save_failed" }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function resetWebhookKeyCache(): void {
  cachedKeys = { at: 0, keys: [] };
}
