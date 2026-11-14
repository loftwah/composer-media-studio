// MIT. Public, read-through access to the installation's Woodhouse Share source.
import { HttpError } from "./util.mjs";

export const shareOrigin = "https://woodhouse.loftwah.com";
export const shareApi = shareOrigin + "/api/v1/assets";
const identifier = /^[a-z0-9][a-z0-9-]{0,127}$/;
const projects = {
  "app-composer": "App Composer",
  "asset-hunter": "Asset Hunter",
  bubbles: "Bubbles",
  fighter: "Fighter",
  foilbury: "Foilbury",
  liferaft: "Liferaft",
  loftwahfm: "LoftwahFM",
  max: "MAX",
  pirates: "Pirates",
  "protocol-11": "Protocol 11",
  shoalshot: "SHOALSHOT",
  "social-club": "Social Club",
  woodhouse: "Woodhouse",
};
export const shareProjects = projects;
export const shareProjectName = (key) => Object.hasOwn(projects, key) ? projects[key] : key;

export function woodhouseUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin === shareOrigin && !url.username && !url.password) return url.href;
  } catch {
    // Invalid catalogue links are skipped.
  }
  return null;
}

function shareFetch(env, url, timeout) {
  const options = { redirect: "error", signal: AbortSignal.timeout(timeout) };
  return env.WOODHOUSE_SOURCE
    ? env.WOODHOUSE_SOURCE.fetch(url, options)
    : fetch(url, options);
}

async function requestCatalogue(env, url) {
  const response = await shareFetch(env, url, 8000);
  if (response.status === 404) throw new HttpError(404, "This artwork is no longer listed in Woodhouse Share.");
  if (!response.ok) throw new Error(`Share catalogue returned HTTP ${response.status}`);
  const data = await response.json();
  if (data.version !== 1) throw new Error("Unexpected Share catalogue version");
  return data;
}

export async function shareAsset(env, assetId) {
  if (typeof assetId !== "string" || !identifier.test(assetId))
    throw new HttpError(400, "Enter a valid Woodhouse Share asset ID.");
  const { asset } = await requestCatalogue(env, shareApi + "/" + assetId);
  if (asset?.id !== assetId || asset.visibility !== "public")
    throw new HttpError(404, "This artwork is no longer public in Woodhouse Share.");
  return asset;
}

export async function sharePage(env, params) {
  const query = (params.get("q") ?? "").trim().slice(0, 100);
  const project = params.get("project") ?? "";
  const after = params.get("after") ?? "";
  const url = new URL(shareApi);
  url.searchParams.set("limit", "24");
  if (query) url.searchParams.set("q", query);
  if (identifier.test(project)) url.searchParams.set("project", project);
  if (identifier.test(after)) url.searchParams.set("after", after);
  const data = await requestCatalogue(env, url.href);
  return {
    query, project, after,
    assets: data.assets.filter((asset) => asset.visibility === "public" && identifier.test(asset.id)),
    nextAfter: identifier.test(data.nextAfter ?? "") ? data.nextAfter : null,
  };
}

export async function shareOriginal(env, asset, limit) {
  const url = woodhouseUrl(asset.original?.url);
  if (!url) throw new HttpError(422, "This artwork has no supported original.");
  const response = await shareFetch(env, url, 20000);
  if (!response.ok || !response.body)
    throw new HttpError(502, "Woodhouse Share did not return the original.");
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body.cancel();
    throw new HttpError(413, "This artwork exceeds the image upload limit.");
  }
  const reader = response.body.getReader();
  const parts = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new HttpError(413, "This artwork exceeds the image upload limit.");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}
