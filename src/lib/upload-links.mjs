// MIT. Short-lived, single-use upload handoffs for originals that are too
// large to pass through a bounded JSON-RPC tool result.
//
// The agent cannot send a 10 MiB song through MCP: tool inputs and results are
// bounded well below that. Instead the server mints one signed URL bound to a
// project, an agent connection, a declared size and a declared SHA-256. The
// agent uploads the original bytes with an ordinary HTTP PUT; the Worker
// re-runs the same sniffing, limits and admission as a multipart upload, then
// the asset is read back through the existing tools.
//
// The URL is a bearer capability, so it must not contain a session cookie. It
// expires quickly, can be used once, and stops working when the connection is
// revoked.

import { constantTimeEqual, HttpError, id as newId, now, text } from "./util.mjs";

// At most fifteen minutes; ten keeps a revoked connection from leaving a long
// unfinished handoff behind.
export const UPLOAD_LINK_TTL_MS = 10 * 60 * 1000;
export const MAX_UPLOAD_LINK_BYTES = 64 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/i;
const LINK_ID = /^upl_[a-f0-9]{32}$/;
const MEDIA_TYPE = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i;

async function hmac(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`upload-link:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function signaturePayload({ id, project_id, expires_at, sha256, bytes }) {
  return `${id}.${project_id}.${expires_at}.${sha256}.${bytes}`;
}

/** The public origin the agent will actually PUT to. The custom domain can sit
 * behind edge rules a different host cannot satisfy, so a configured
 * PUBLIC_ORIGIN wins. Plain HTTP is accepted only for a local Studio. */
function uploadOrigin(env, request) {
  const configured = String(env.PUBLIC_ORIGIN ?? "").trim().replace(/\/$/, "");
  let origin;
  try {
    origin = new URL(configured || new URL(request.url).origin);
  } catch {
    throw new HttpError(503, "This studio does not know a safe public address for uploads", "not_configured");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" && !local)
  )
    throw new HttpError(503, "This studio does not know a safe public address for uploads", "not_configured");
  return origin.origin;
}

/** The declared type is only a hint: bytes are sniffed on arrival. Validate it
 * anyway so a client cannot store arbitrary text in the staging row. */
export function uploadLinkLimit(contentType) {
  return String(contentType ?? "").toLowerCase().startsWith("video/") ? 64 * 1024 * 1024 : 32 * 1024 * 1024;
}

/** Validate the begin request and write exactly one staging row. The row holds
 * the nonce and consumed state; the URL signature binds every value an agent
 * could otherwise change. */
export async function createUploadLink(env, { projectId, tokenId, filename, contentType, bytes, sha256, request }) {
  if (!env.SESSION_SECRET) throw new HttpError(503, "Studio session secret is not configured", "not_configured");
  const cleanName = text(filename, 200, "Filename");
  if (/[\\/]/.test(cleanName)) throw new HttpError(400, "Filename must not contain a path.", "invalid_filename");
  const type = String(contentType ?? "").trim().toLowerCase();
  if (type.length > 100 || !MEDIA_TYPE.test(type))
    throw new HttpError(400, "Send a media type such as audio/wav.", "invalid_content_type");
  if (!Number.isSafeInteger(bytes) || bytes < 1)
    throw new HttpError(400, "Send the exact file size in bytes.", "invalid_size");
  if (bytes > MAX_UPLOAD_LINK_BYTES)
    throw new HttpError(413, `Uploads must stay under ${MAX_UPLOAD_LINK_BYTES / 1024 / 1024} MiB`, "too_large");
  const hash = String(sha256 ?? "").trim().toLowerCase();
  if (!SHA256.test(hash))
    throw new HttpError(400, "Send the file's SHA-256 as 64 hexadecimal characters.", "invalid_sha256");

  const linkId = newId("upl");
  const timestamp = now();
  const expiresAt = timestamp + UPLOAD_LINK_TTL_MS;
  const row = {
    id: linkId,
    project_id: projectId,
    expires_at: expiresAt,
    sha256: hash,
    bytes,
  };
  const signature = await hmac(env.SESSION_SECRET, signaturePayload(row));
  await env.DB.prepare(
    "INSERT INTO asset_upload_links(id,project_id,token_id,sha256,bytes,mime,filename,created_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
  )
    .bind(linkId, projectId, tokenId, hash, bytes, type, cleanName, timestamp, expiresAt)
    .run();

  const url = new URL(`/upload/assets/${linkId}`, uploadOrigin(env, request));
  url.searchParams.set("p", projectId);
  url.searchParams.set("e", String(expiresAt));
  url.searchParams.set("s", signature);
  return {
    uploadUrl: url.href,
    expiresAt,
    maxBytes: uploadLinkLimit(type),
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
  };
}

export async function loadUploadLink(env, linkId) {
  if (!LINK_ID.test(String(linkId ?? ""))) return null;
  return env.DB.prepare("SELECT * FROM asset_upload_links WHERE id=?1").bind(linkId).first();
}

/** Constant-time check of the URL signature over the values stored in D1.
 * A changed project, expiry, hash or size therefore invalidates the URL. */
export async function verifyUploadLink(env, row, { expires, signature }) {
  if (!env.SESSION_SECRET) return false;
  if (Number(expires) !== row.expires_at) return false;
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = await hmac(env.SESSION_SECRET, signaturePayload(row));
  return constantTimeEqual(signature, expected);
}

/** One conditional write claims the link. A replay, an expiry or a concurrent
 * request finds no matching row and changes nothing. */
export async function claimUploadLink(env, row, timestamp = now()) {
  const claimed = await env.DB.prepare(
    "UPDATE asset_upload_links SET consumed_at=?2 WHERE id=?1 AND consumed_at IS NULL AND expires_at>?2",
  )
    .bind(row.id, timestamp)
    .run();
  return Number(claimed?.meta?.changes ?? claimed?.changes ?? 0) > 0;
}

/** Read exactly the declared number of bytes, refusing anything larger before
 * it can be hashed, sniffed or stored. */
export async function readBoundedBody(request, declaredBytes) {
  const length = request.headers.get("content-length");
  if (length !== null) {
    const hinted = Number(length);
    if (!Number.isSafeInteger(hinted) || hinted < 0)
      throw new HttpError(400, "Send the file as the request body.", "invalid_body");
    if (hinted > declaredBytes)
      throw new HttpError(413, "The upload is larger than the declared size. Nothing was saved.", "too_large");
  }
  if (!request.body) throw new HttpError(400, "The upload was empty. Nothing was saved.", "size_mismatch");
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > declaredBytes) {
        await reader.cancel();
        throw new HttpError(413, "The upload is larger than the declared size. Nothing was saved.", "too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
