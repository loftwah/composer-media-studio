// MIT. Media Studio Worker: owner studio, public pages and the job engine.

import { readLoftwahFmTrack } from "./lib/loftwahfm-import.mjs";
import { darkroomOriginalKey, isDarkroomGeneration } from "./lib/darkroom.mjs";
import {
  allowedActions,
  can,
  checkLoginRate,
  claimHandoff,
  clearCookie,
  createSession,
  projectAccessible,
  projectResumeBinding,
  projectAccessDeniedMessage,
  readBridgeToken,
  readSession,
  recordLoginFailure,
  requireSession,
  sessionCookie,
  sessionBinding,
  verifyComposerGrant,
  verifyComposerRead,
  verifyPassphrase,
} from "./lib/auth.mjs";
import {
  advanceGeneration,
  budgetSnapshot,
  cancelGeneration,
  createComposition,
  createStoryboardFromSongPlan,
  createGeneration,
  createRender,
  dispatchGeneration,
  eraseDeletedGeneration,
  eraseGenerationResult,
  updateComposition,
  dispatchRender,
  loadGeneration,
  loadProject,
  pendingGenerations,
  reconcileGeneration,
  saveGeneration,
} from "./lib/jobs.mjs";
import { createFootagePlan, listFootagePlans, updateFootagePlan } from "./lib/footage-plans.ts";
import { previewSceneProposal, applySceneProposal } from "./lib/scene-proposals.ts";
import { proposeSceneDirection, diagnoseShots } from "./lib/director.ts";
import { createSongPlan, importSongPlan, listSongPlans, updateSongPlan, updateSongCaptions, exportSongCaptions } from "./lib/song-plans.ts";
import { createLocalRenderReceipt } from "./lib/local-render-receipts.ts";
import { createFootageExportReceipt } from "./lib/footage-export-receipts.ts";
import {
  addReviewFeedback,
  assertFeedbackAttemptAllowed,
  assertReviewAttemptAllowed,
  compareReviewRooms,
  createReviewRoom,
  listReviewRooms,
  openReviewRoom,
  ownerReviewRoomView,
  publicReviewRoomView,
  compareReviewRoomsForReviewer,
  assertCompareAttemptAllowed,
  recordReviewDecision,
  recordReviewFailure,
  revokeReviewRoom,
  reviewFeedbackForRoom,
  rotateReviewRoomToken,
  setFeedbackResolved,
  pruneReviewAttempts,
} from "./lib/review-rooms.mjs";
import { measureFootageSource } from "./lib/footage-preflight.ts";
import { webmVideoSize } from "./lib/webm-metadata.ts";
import { listSubjects, subjectVersions, saveSubject } from "./lib/subjects.ts";
import { listPromoBriefs, createPromoBrief, updatePromoBrief } from "./lib/promo-briefs.ts";
import { models, publicModels, publicRetiredModels, retiredModels, getModel, validateSettings, estimateCost, PROVIDER_FAL, PROVIDER_CLOUDFLARE } from "./lib/providers.mjs";
import { handleFalWebhook } from "./lib/fal-webhook.mjs";
import { builtinRecipe, projectRecipes, renderPrompt, builtinRecipes } from "./lib/recipes.ts";
import { reuseStillFor, sharingDestinations } from "./lib/sharing.ts";
import { shareAsset, shareOriginal, sharePage, woodhouseUrl, shareApi, shareOrigin } from "./lib/woodhouse-share.ts";
import { composerShare } from "./lib/composer-share.ts";
import { shell, loginPage, publicPage, notFoundPage, helpPage, audioTrimPage, videoClipPage, addMusicPage, imagesPage, publicGallery, comparePage, reviewRoomPage, reviewComparePage, reviewRefusalPage } from "./lib/ui.mjs";
import { costSummary, jobCatalogue, latestPerModel, likeForLike, verdict as compareVerdict, weakness as compareWeakness } from "./lib/comparisons.ts";
import { verifyRenderLink } from "./lib/render-links.mjs";
import { claimUploadLink, createUploadLink, loadUploadLink, readBoundedBody, verifyUploadLink } from "./lib/upload-links.mjs";
import { inventory, policyFor, publishCandidate, setPolicy, boundedBackfill } from "./lib/publication-policy.mjs";
import { bulkPublicationChange, publicationAudit } from "./lib/publication-bulk.mjs";
import { PUBLIC_CACHE_SECONDS, publicOrigin, publicSitemap, robotsTxt } from "./lib/sitemap.ts";
import { checkPublicImage } from "./lib/public-image-privacy.ts";
import { deletePublicationDerivatives, MAX_DERIVATIVE_BYTES, storeDerivative, storePosterDerivative, storePosterUpload } from "./lib/publication-derivatives.ts";
import { deleteAssetPreviews, readAssetPreview, storeAssetPreview, storeAssetPreviewUpload } from "./lib/asset-previews.ts";
import { createStudioMcpHandler } from "./mcp/tools.mjs";
import { assetUsageReport, findDuplicateOriginal, projectStorageReport } from "./lib/storage-doctor.ts";
import { readCapabilityManifest, readCapabilityState, refreshCapabilities } from "./lib/capabilities.ts";
import { authorizeMcp, oauthRoute, pruneMcpRecords, reserveMcpSpend } from "./mcp/oauth.mjs";
import {
  PortableError,
  beginPortableImport,
  cleanupPortableImport,
  commitPortableImport,
  exportProjectManifest,
  importStatus,
  portableInventory,
  previewPortableImport,
  stagePortableAsset,
} from "./lib/portable-bundle.mjs";
import {
  audioInfo,
  constantTimeEqual,
  escapeHtml,
  extensionFor,
  HttpError,
  id,
  imageSize,
  json,
  money,
  now,
  problem,
  safeJson,
  sha256Hex,
  slug,
  sniffMedia,
  text,
  videoInfo,
} from "./lib/util.mjs";

const BUILD = {
  revision: typeof __BUILD_REVISION__ === "string" ? __BUILD_REVISION__ : "dev",
  builtAt: typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : new Date(0).toISOString(),
};

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_VIDEO_BYTES = 64 * 1024 * 1024;
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;

function securityHeaders(response, woodhouse = false, { noReferrer = false } = {}) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", noReferrer ? "no-referrer" : "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set(
    "content-security-policy",
    `default-src 'self'; img-src 'self' data: blob:${woodhouse ? " " + shareOrigin : ""}; media-src 'self' blob:; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  );
  return new Response(response.body, { status: response.status, headers });
}

function assertSameOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const requestOrigin = new URL(request.url).origin;
  const allowed = new Set([requestOrigin]);
  if (env.PUBLIC_ORIGIN) allowed.add(env.PUBLIC_ORIGIN.replace(/\/$/, ""));
  if (!allowed.has(origin))
    throw new HttpError(403, "This request came from another site", "origin_refused");
}

async function eraseAsset(env, asset) {
  try {
    // A private library preview must not outlive the asset it stands in for.
    await deleteAssetPreviews(env, [asset.id]);
    const generation = asset.generation_id ? await loadGeneration(env, asset.generation_id) : null;
    if (!generation || !isDarkroomGeneration(generation) || asset.r2_key !== darkroomOriginalKey(generation))
      await env.MEDIA.delete(asset.r2_key);
    if (generation) await eraseGenerationResult(env, generation);
    await env.DB.prepare("UPDATE assets SET erasure_pending=0 WHERE id=?1").bind(asset.id).run();
  } catch (error) {
    await env.DB.prepare("UPDATE assets SET updated_at=?2 WHERE id=?1").bind(asset.id, now()).run();
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "Deletion is pending. Studio will retry cleanup.", "erasure_pending");
  }
}

async function body(request, limit = 64 * 1024) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json"))
    throw new HttpError(415, "Send JSON for this action", "unsupported_media_type");
  const raw = await request.text();
  if (raw.length > limit) throw new HttpError(413, "That request is too large", "too_large");
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("object required");
    return parsed;
  } catch {
    throw new HttpError(400, "Send a JSON object", "invalid_json");
  }
}

async function rawPortableBody(request, limit = 64 * 1024 * 1024) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, "That media is too large for one bundle entry.", "too_large");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > limit) throw new HttpError(413, "That media is too large for one bundle entry.", "too_large");
  return bytes;
}

function rangeHeaders(range, size) {
  return {
    "accept-ranges": "bytes",
    "content-length": String(range ? range.length : size),
    ...(range ? { "content-range": `bytes ${range.start}-${range.end}/${size}` } : {}),
  };
}

/** A conditional request for published bytes: compare one strong tag per entry. */
function matchesEtag(header, etag) {
  if (!header) return false;
  return String(header).split(",").some((entry) => {
    const tag = entry.trim().replace(/^W\//, "");
    return tag === "*" || tag === etag;
  });
}

/** Parse one byte range. Range playback is a real media feature, not a label. */
function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return { invalid: true };
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start === null && end === null) return { invalid: true };
  if (start === null) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (end === null) {
    end = size - 1;
  }
  end = Math.min(end, size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end)
    return { invalid: true };
  return { offset: start, length: end - start + 1, start, end };
}

function assetView(asset, extra = {}) {
  return {
    id: asset.id,
    kind: asset.kind,
    title: asset.title,
    caption: asset.caption,
    mime: asset.mime,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
    durationMs: asset.duration_ms,
    sampleRate: asset.sample_rate ?? null,
    channels: asset.channels ?? null,
    sha256: asset.sha256,
    source: asset.source,
    // The immediate upload/import response must carry the same self-reference
    // as a fresh project read. Video relationships are supplied by that read.
    reuseStillId: reuseStillFor({ asset, assets: [asset] })?.id ?? null,
    parentAssetId: asset.parent_asset_id,
    generationId: asset.generation_id,
    createdAt: asset.created_at,
    file: `/api/assets/${asset.id}/file`,
    download: `/api/assets/${asset.id}/download`,
    ...extra,
  };
}

function modelAttribution(generation) {
  const request = safeJson(generation.request_json, {});
  const current = models[generation.model];
  const retired = retiredModels[generation.model];
  return {
    modelLabel: current?.label ?? retired?.label ?? generation.model,
    modelEndpoint: request.modelEndpoint ?? current?.endpoint ?? retired?.endpoint ?? null,
    modelRetired: Boolean(retired),
  };
}

function generationView(generation, extra = {}) {
  const request = safeJson(generation.request_json, {});
  return {
    id: generation.id,
    kind: generation.kind,
    status: generation.status,
    model: generation.model,
    ...modelAttribution(generation),
    recipeId: generation.recipe_id,
    compositionId: generation.composition_id ?? null,
    variant: request.variant ?? null,
    prompt: request.prompt ?? "",
    aspect: request.aspect ?? null,
    durationSeconds: request.durationSeconds ?? null,
    referenceAssetId: request.referenceAssetId ?? null,
    maskAssetId: request.maskAssetId ?? null,
    maskSha256: request.maskSha256 ?? null,
    parentAssetId: request.parentAssetId ?? null,
    costEstimateMicro: generation.cost_estimate_micro,
    costAllocatedMicro: generation.cost_allocated_micro,
    error: generation.error_code
      ? { code: generation.error_code, message: generation.error_detail ?? "" }
      : null,
    assetId: generation.output_asset_id,
    createdAt: generation.created_at,
    updatedAt: generation.updated_at,
    completedAt: generation.completed_at,
    ...extra,
  };
}

// These films were explicitly selected for the Portfolio showcase. The
// showcase is independent of a film's inclusion in the general Gallery.
async function shareShowcaseFilms(env) {
  const slugs = [...new Set(String(env.PUBLIC_SHOWCASE_SLUGS ?? "").split(",")
    .map((value) => value.trim()).filter((value) => /^[A-Za-z0-9_-]{1,80}$/.test(value)))].slice(0, 24);
  if (!slugs.length) return [];
  const films = await env.DB.prepare(`SELECT p.slug,p.title
    FROM publications p JOIN assets a ON a.id=p.asset_id AND a.project_id=p.project_id
    WHERE p.slug IN (${slugs.map(() => "?").join(",")}) AND p.revoked_at IS NULL
      AND p.hidden=0 AND a.deleted_at IS NULL AND a.kind='video'`).bind(...slugs).all();
  const bySlug = new Map(films.results.map((film) => [film.slug, film]));
  return slugs.flatMap((slug) => bySlug.has(slug) ? [bySlug.get(slug)] : []);
}

// Only explicitly configured, still-published films are safe for the home gallery.
async function homeShowcase(env, { listedOnly = false } = {}) {
  const slugs = String(env.PUBLIC_SHOWCASE_SLUGS ?? "").split(",").map((value) => value.trim()).filter((value) => /^[A-Za-z0-9_-]{1,80}$/.test(value)).slice(0, 8);
  const rows = await Promise.all(slugs.map((value) => env.DB.prepare(`SELECT p.slug,p.title,p.description,poster.id AS poster_asset_id,a.mime,
    d.publication_id AS poster_preview_id,d.width AS poster_preview_width,d.height AS poster_preview_height,
    t.publication_id AS thumb_id,t.width AS thumb_width,t.height AS thumb_height
    FROM publications p JOIN assets a ON a.id=p.asset_id
    LEFT JOIN assets poster ON poster.id=p.poster_asset_id AND poster.project_id=p.project_id AND poster.kind='image' AND poster.deleted_at IS NULL
    LEFT JOIN publication_derivatives d ON d.publication_id=p.id AND d.kind='poster' AND d.source_sha256=poster.sha256
    LEFT JOIN publication_derivatives t ON t.publication_id=p.id AND t.kind='thumb'
    WHERE p.slug=?1 AND p.revoked_at IS NULL AND p.hidden=0 AND a.deleted_at IS NULL AND a.kind='video'
      ${listedOnly ? 'AND p.listed=1' : ''}`).bind(value).first()));
  return rows.filter(Boolean).slice(0, 3).map((row) => ({
    slug: row.slug,
    title: row.title,
    description: row.description,
    mime: row.mime,
    hasPoster: Boolean(row.poster_asset_id),
    ...(row.thumb_id ? { thumb_id: row.thumb_id, thumb_width: row.thumb_width, thumb_height: row.thumb_height } : {}),
    ...(row.poster_preview_id
      ? {
          poster_preview_id: row.poster_preview_id,
          poster_preview_width: row.poster_preview_width,
          poster_preview_height: row.poster_preview_height,
        }
      : {}),
  }));
}

// Capability is derived from stored lineage only: never from a title, a prompt
// or a filename. `assembled` records a composition or multi-track assembly;
// `refinement` is an edit of an existing asset (mask, edit model or saved
// variant); `variation` used an existing asset as its input; `original` is a
// saved generation with no recorded input asset. Uploads, deleted or unreadable
// generation records stay absent and never match a capability filter.
const capabilitySql = `CASE
  WHEN a.source='assembled' OR g.composition_id IS NOT NULL THEN 'assembled'
  WHEN json_valid(g.request_json) AND json_type(g.request_json)='object' AND (
    json_type(g.request_json,'$.shots') IN ('array','object')
    OR json_type(g.request_json,'$.audioTracks')='array'
    OR json_type(g.request_json,'$.slateAssetId')='text'
    OR json_type(g.request_json,'$.slateVideoAssetId')='text'
  ) THEN 'assembled'
  WHEN (a.source='variant' AND a.parent_asset_id IS NOT NULL)
    OR (json_valid(g.request_json) AND json_type(g.request_json)='object' AND (
      json_type(g.request_json,'$.maskAssetId')='text'
      OR json_type(g.request_json,'$.maskSha256')='text'
      OR g.model IN ('studio-fill','studio-cutout','studio-upscale','kling-o1-restyle')
    )) THEN 'refinement'
  WHEN a.parent_asset_id IS NOT NULL
    OR (json_valid(g.request_json) AND json_type(g.request_json)='object' AND (
      json_type(g.request_json,'$.referenceAssetId')='text'
      OR json_type(g.request_json,'$.parentAssetId')='text'
    )) THEN 'variation'
  WHEN a.source='generated' AND json_valid(g.request_json) AND json_type(g.request_json)='object' THEN 'original'
  ELSE NULL END`;

// The public browse facets are a stable, small taxonomy rather than whatever a
// single page happens to contain.
const CAPABILITY_ORDER = ["original", "variation", "refinement", "assembled"];

// One CTE keeps the card query, its total and its facet options on exactly the
// same public boundary. `listed=1` is the deliberate listing decision: hidden,
// unlisted, withdrawn and privately published rows never enter `works`.
const publicWorksSql = `WITH works AS (
  SELECT p.id,p.project_id,p.slug,p.title,p.description,p.created_at,a.kind,a.mime,a.width,a.height,
    pr.slug AS project_slug,pr.name AS project_name,
    poster.id AS poster_asset_id,poster.width AS poster_width,poster.height AS poster_height,
    t.publication_id AS thumb_id,t.width AS thumb_width,t.height AS thumb_height,
    pd.publication_id AS poster_preview_id,pd.width AS poster_preview_width,pd.height AS poster_preview_height,
    ${capabilitySql} AS capability
  FROM publications p
  JOIN assets a ON a.id=p.asset_id AND a.project_id=p.project_id
  JOIN projects pr ON pr.id=p.project_id
  LEFT JOIN generations g ON g.id=a.generation_id AND g.project_id=p.project_id AND g.deleted_at IS NULL
  LEFT JOIN assets poster ON poster.id=p.poster_asset_id AND poster.project_id=p.project_id AND poster.kind='image' AND poster.deleted_at IS NULL
  LEFT JOIN publication_derivatives t ON t.publication_id=p.id AND t.kind='thumb'
  LEFT JOIN publication_derivatives pd ON pd.publication_id=p.id AND pd.kind='poster' AND pd.source_sha256=poster.sha256
  WHERE p.listed=1 AND p.hidden=0 AND p.revoked_at IS NULL AND a.deleted_at IS NULL
)`;
const publicWorksFilter = `WHERE (?1 = '' OR instr(lower(title), lower(?1)) > 0 OR instr(lower(description), lower(?1)) > 0)
  AND (?2 = '' OR kind = ?2)
  AND (?3 = '' OR project_slug = ?3)
  AND (?4 = '' OR capability = ?4)`;

/**
 * Read the public catalogue, its honest total and the facets that actually have
 * at least one listed work. Unknown project or capability values are ignored,
 * matching the existing invalid-kind fallback, so a stale link still renders.
 * The query count is fixed (three for the gallery, two for the home preview) and
 * never grows with the number of cards.
 */
async function publicCatalogue(env, page = 1, limit = 24, { query = "", kind = "", order = "newest", project = "", capability = "", withFacets = true } = {}) {
  const direction = order === "oldest" ? "ASC" : "DESC";
  let facets = { projects: [], capabilities: [] };
  if (withFacets) {
    const facetRows = await env.DB.prepare(`${publicWorksSql}
      SELECT 'project' AS facet,project_slug AS value,project_name AS label,COUNT(*) AS works FROM works
      GROUP BY project_slug,project_name
      UNION ALL
      SELECT 'capability' AS facet,capability AS value,capability AS label,COUNT(*) AS works FROM works
      WHERE capability IS NOT NULL GROUP BY capability
      ORDER BY facet,label COLLATE NOCASE`).all();
    const projectFacets = facetRows.results.filter((row) => row.facet === "project");
    const present = new Set(facetRows.results.filter((row) => row.facet === "capability").map((row) => row.value));
    facets = {
      projects: projectFacets.map((row) => ({ value: row.value, label: row.label })),
      capabilities: CAPABILITY_ORDER.filter((value) => present.has(value)),
    };
  }
  const selectedProject = facets.projects.some((entry) => entry.value === project) ? project : "";
  const selectedCapability = facets.capabilities.includes(capability) ? capability : "";
  const [result, count] = await Promise.all([
    env.DB.prepare(`${publicWorksSql}
      SELECT slug,title,description,created_at,kind,mime,width,height,project_name,capability,
        poster_asset_id,poster_width,poster_height,thumb_id,thumb_width,thumb_height,
        poster_preview_id,poster_preview_width,poster_preview_height
      FROM works ${publicWorksFilter}
      ORDER BY created_at ${direction},id ${direction} LIMIT ?5 OFFSET ?6`)
      .bind(query, kind, selectedProject, selectedCapability, limit + 1, (page - 1) * limit)
      .all(),
    env.DB.prepare(`${publicWorksSql} SELECT COUNT(*) AS total FROM works ${publicWorksFilter}`)
      .bind(query, kind, selectedProject, selectedCapability)
      .first(),
  ]);
  return {
    items: result.results.slice(0, limit),
    hasMore: result.results.length > limit,
    total: count?.total ?? 0,
    projects: facets.projects,
    capabilities: facets.capabilities,
    project: selectedProject,
    capability: selectedCapability,
  };
}

/**
 * Up to three other listed, still-public works from the SAME project as the
 * current page. This reuses the exact `works` public boundary above — listed,
 * not hidden, not withdrawn and backed by a live asset — so an unlisted,
 * private, withdrawn or deleted work can never enter, and a different project
 * is excluded by its stored project id rather than a guessed relationship.
 * One bounded query, deterministic newest-first order (id breaks ties), no
 * facets. The caller checks that the current work is also listed.
 */
async function relatedWorks(env, projectId, excludeId) {
  if (!projectId || !excludeId) return [];
  const result = await env.DB.prepare(`${publicWorksSql}
    SELECT slug,title,description,created_at,kind,mime,width,height,
      thumb_id,thumb_width,thumb_height,poster_asset_id,poster_width,poster_height,
      poster_preview_id,poster_preview_width,poster_preview_height
    FROM works WHERE project_id=?1 AND id!=?2
    ORDER BY created_at DESC, id DESC LIMIT 3`)
    .bind(projectId, excludeId)
    .all();
  return result.results;
}

/** Every private route that names a project checks the same binding: the
 * project must belong to this session's workspace and, when the handoff named
 * one project, to that project. Standalone owner sessions own every project. */
/** The project a page should speak about: the session's claimed project when the
 * studio link named one, otherwise the owner's most recently used project. */
async function currentProject(env, session) {
  if (session?.project) {
    const claimed = await loadProject(env, session.project, { required: false });
    if (claimed && projectAccessible(session, claimed)) return claimed;
  }
  // Only a standalone owner session may fall back to "the newest project".
  // A bridged workspace session without a project claim gets nothing rather than
  // another workspace's work.
  if (session?.mode !== "owner") return null;
  const newest = await env.DB.prepare("SELECT * FROM projects ORDER BY updated_at DESC LIMIT 1").first();
  return newest ?? null;
}

async function assertProjectAccess(env, session, projectId) {
  if (!projectId || session.mode === "owner") return;
  const project = await env.DB.prepare("SELECT id,workspace_id FROM projects WHERE id=?1")
    .bind(projectId)
    .first();
  if (!project) throw new HttpError(404, "Project not found", "not_found");
  // An agent connection is granted exactly one project. Say so, instead of
  // blaming the workspace: an agent that asks for a second project reads the
  // workspace message as "the owner must reopen Studio", which is the wrong fix.
  if (!projectAccessible(session, project))
    throw new HttpError(403, projectAccessDeniedMessage(session, projectId), "forbidden");
}

async function projectSummary(env, project) {
  const counts = await env.DB.prepare(
    "SELECT kind, COUNT(*) AS n FROM assets WHERE project_id=?1 AND deleted_at IS NULL GROUP BY kind",
  )
    .bind(project.id)
    .all();
  const byKind = Object.fromEntries(counts.results.map((row) => [row.kind, row.n]));
  const cover = await env.DB.prepare(
    "SELECT id FROM assets WHERE project_id=?1 AND deleted_at IS NULL AND kind='image' ORDER BY created_at DESC LIMIT 1",
  )
    .bind(project.id)
    .first();
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    creativeDirection: project.creative_direction,
    visibility: project.visibility,
    defaults: safeJson(project.defaults_json, {}),
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    counts: { image: byKind.image ?? 0, video: byKind.video ?? 0, audio: byKind.audio ?? 0 },
    cover: cover ? `/api/assets/${cover.id}/file` : null,
    budget: await budgetSnapshot(env, project.id),
  };
}

async function handleLogin(request, env) {
  assertSameOrigin(request, env);
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  if (request.method === "POST") {
    await checkLoginRate(env, ip);
    const input = await body(request, 4 * 1024);
    const ok = await verifyPassphrase(env, input.passphrase);
    if (!ok) {
      await recordLoginFailure(env, ip);
      throw new HttpError(401, "That passphrase did not match", "unauthorized");
    }
    const token = await createSession(env);
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(token) });
  }
  return new Response(loginPage({ next: "/", revision: BUILD.revision, bridged: Boolean(env.BRIDGE_SECRET), composerOrigin: env.COMPOSER_ORIGIN, storyUrl: env.PUBLIC_STORY_URL, woodhouseShare: env.WOODHOUSE_SHARE === "true" }), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function reviewCompareFormToken(request) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/x-www-form-urlencoded"))
    throw new HttpError(415, "Send the second private review link as a form", "unsupported_media_type");
  const raw = await request.text();
  if (raw.length > 4096) throw new HttpError(413, "That request is too large", "too_large");
  return new URLSearchParams(raw).get("compareToken") ?? "";
}

async function handleReviewApi(request, env, path) {
  // Comparing two links the reviewer already holds. Both are checked by token
  // hash and status; the answer is generic unless the pair is valid and open.
  if (path === "/api/review/compare") {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed", "method_not_allowed");
    assertSameOrigin(request, env);
    await assertCompareAttemptAllowed(env, request);
    const input = await body(request, 4096);
    return json(await compareReviewRoomsForReviewer(env, input?.left, input?.right));
  }
  const match = path.match(/^\/api\/review\/([A-Za-z0-9_-]{43})(?:\/(feedback|decision))?$/);
  if (!match) throw new HttpError(404, "Not found", "not_found");
  const [, token, operation] = match;
  if (operation && request.method !== "POST") throw new HttpError(405, "Method not allowed", "method_not_allowed");
  if (!operation && request.method !== "GET") throw new HttpError(405, "Method not allowed", "method_not_allowed");
  if (operation) assertSameOrigin(request, env);

  await assertReviewAttemptAllowed(env, request);
  let access;
  try {
    access = await openReviewRoom(env, token);
  } catch (error) {
    if (error instanceof HttpError && (error.status === 404 || error.status === 410))
      await recordReviewFailure(env, request).catch(() => {});
    throw error;
  }
  const { room } = access;
  if (!operation) {
    const feedback = await reviewFeedbackForRoom(env, room);
    return json({ room: publicReviewRoomView(room, feedback) });
  }
  if (operation === "feedback") {
    await assertFeedbackAttemptAllowed(env, room, request);
    const input = await body(request, 8 * 1024);
    const feedback = await addReviewFeedback(env, room, input);
    const updated = await env.DB.prepare("SELECT * FROM review_rooms WHERE id=?1 AND project_id=?2")
      .bind(room.id, room.project_id)
      .first();
    return json(
      {
        feedback,
        room: publicReviewRoomView(updated, await reviewFeedbackForRoom(env, updated)),
      },
      201,
    );
  }
  const input = await body(request, 8 * 1024);
  await recordReviewDecision(env, room, input);
  const updated = await env.DB.prepare("SELECT * FROM review_rooms WHERE id=?1 AND project_id=?2")
    .bind(room.id, room.project_id)
    .first();
  return json({ room: publicReviewRoomView(updated, await reviewFeedbackForRoom(env, updated)) });
}

async function handleApi(request, env, url, ctx, scopedAgent = null) {
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;

  if (path === "/api/login") return handleLogin(request, env);

  if (path === "/api/logout" && request.method === "POST") {
    assertSameOrigin(request, env);
    return json({ ok: true }, 200, { "set-cookie": clearCookie() });
  }

  if (path === "/api/bridge" && request.method === "POST") {
    const input = await body(request);
    const claim = await readBridgeToken(env, input.token);
    if (!claim) throw new HttpError(401, "This Composer handoff is not valid or has expired", "unauthorized");
    if (!(await claimHandoff(env, claim)))
      throw new HttpError(409, "This Composer handoff was already used. Reopen the studio from Composer.", "handoff_replayed");
    const token = await createSession(env, {
      mode: "bridge",
      actor: claim.actor,
      actorName: claim.actorName,
      workspace: claim.workspace,
      workspaceName: claim.workspaceName,
      project: claim.project,
      projectClaimExplicit: true,
      actions: claim.actions,
      revision: claim.revision,
    });
    return json(
      {
        ok: true,
        next: "/",
        actor: claim.actorName ?? claim.actor,
        workspace: claim.workspaceName ?? claim.workspace,
        project: claim.project,
        actions: claim.actions,
      },
      200,
      { "set-cookie": sessionCookie(token, "bridge") },
    );
  }

  // fal's completion webhook is unauthenticated by nature. The handler
  // verifies fal's Ed25519 signature and can only update the job that already
  // holds the delivered request id, so it sits before the session gate.
  if (path === "/api/fal/webhook" && method === "POST") return handleFalWebhook(request, env);

  // A private review link is a bearer capability. It is checked by hash on
  // every request and never inherits an owner session or project access.
  if (path.startsWith("/api/review/")) return handleReviewApi(request, env, path);

  if (path === "/api/session") {
    const session = await readSession(env, request);
    // A bridge session reports the actions it still has, not the actions it had
    // when the handoff was minted. Revoked access empties the permissions and
    // the studio asks to be reopened from Composer instead of failing mid-edit.
    let live = session;
    if (session && session.mode !== "owner") {
      try {
        await verifyComposerRead(env, session, "read");
      } catch {
        live = null;
      }
    }
    return json({
      signedIn: Boolean(live),
      localImportBinding: await sessionBinding(env, live),
      projectResumeBinding: await projectResumeBinding(env, live),
      mode: live?.mode ?? null,
      actor: live?.actorName ?? live?.actor ?? null,
      workspace: live?.workspaceName ?? live?.workspace ?? null,
      project: live?.project ?? null,
      actions: allowedActions(live),
      revoked: Boolean(session && !live),
      composerOrigin: typeof env.COMPOSER_ORIGIN === "string" ? env.COMPOSER_ORIGIN : null,
      storyUrl: typeof env.PUBLIC_STORY_URL === "string" ? env.PUBLIC_STORY_URL : null,
    });
  }

  // Every private route declares the action it needs. A project-scoped bridge
  // session cannot read or change another project, even with a valid cookie.
  const projectIdFromPath = (path.match(/^\/api\/projects\/([a-z0-9_]+)/) ?? [])[1] ?? null;
  let action = method === "GET" || method === "HEAD" ? "read" : "edit";
  if (path === "/api/state" || path === "/api/models") action = "read";
  if (path === "/api/capabilities/refresh" && method === "POST") action = "admin";
  if (path === "/api/projects" && method === "POST") action = "edit";
  if (/\/generations$/.test(path) && method === "POST") action = "generate";
  if (/\/render$/.test(path) && method === "POST") action = "generate";
  if (/\/publish$/.test(path) && method === "POST") action = "publish";
  if (/^\/api\/publications\//.test(path)) action = "publish";
  if (/^\/api\/projects\/[a-z0-9_]+\/publication-(policy|inventory|reconcile|backfill|audit)$/.test(path)) action = "publish";
  if (/^\/api\/projects\/[a-z0-9_]+\/publications\/bulk$/.test(path)) action = "publish";
  if (/^\/api\/generations\/[a-z0-9_]+$/.test(path) && method === "DELETE") action = "edit";
  if (/^\/api\/generations\/[a-z0-9_]+\/(cancel|reconcile|save-retry)$/.test(path)) action = "generate";
  if (/\/export$/.test(path)) action = "read";
  if (/^\/api\/projects\/[a-z0-9_]+\/portable-export$/.test(path)) action = "read";
  if (/^\/api\/studio\//.test(path)) action = "admin";
  if (/^\/api\/projects\/[a-z0-9_]+\/storage-report$/.test(path)) action = "admin";
  if (method === "POST" && /^\/api\/projects\/[a-z0-9_]+\/assets\/(preflight|reuse)$/.test(path)) action = "read";
  // Share search is read-only on the wire, but it belongs to the same owner
  // import capability as the POST: require the actual edit role so a read-only
  // session or a scoped agent cannot browse the Share catalogue either.
  if (/^\/api\/projects\/[a-z0-9_]+\/assets\/woodhouse$/.test(path)) action = "edit";
  if (method === "POST" && /^\/api\/projects\/[a-z0-9_]+\/song-plans\/[a-z0-9_]+\/scene-proposal\/preview$/.test(path)) action = "read";
  if (method === "POST" && /^\/api\/projects\/[a-z0-9_]+\/song-plans\/[a-z0-9_]+\/shot-diagnosis$/.test(path)) action = "read";
  if (method === "POST" && /^\/api\/projects\/[a-z0-9_]+\/song-plans\/[a-z0-9_]+\/director$/.test(path)) action = "edit";

  const session = scopedAgent ?? await requireSession(env, request, action);
  if (scopedAgent && !can(session, action))
    throw new HttpError(403, "This agent connection does not permit this action.", "forbidden");
  if (projectIdFromPath) await assertProjectAccess(env, session, projectIdFromPath);

  if (method !== "GET" && method !== "HEAD") assertSameOrigin(request, env);

  const publicationPolicyMatch = path.match(/^\/api\/projects\/([a-z0-9_]+)\/publication-(policy|inventory|reconcile|backfill|audit)$/);
  if (publicationPolicyMatch) {
    const [, projectId, operation] = publicationPolicyMatch;
    const project = await env.DB.prepare("SELECT id FROM projects WHERE id=?1").bind(projectId).first();
    if (!project) throw new HttpError(404, "Project not found", "not_found");
    if (operation === "policy" && method === "GET") return json(await policyFor(env, projectId));
    if (operation === "policy" && method === "PUT") {
      const input = await body(request);
      if (typeof input.enabled !== "boolean") throw new HttpError(400, "Send enabled as a boolean.");
      return json(await setPolicy(env, projectId, input.enabled, input.rightsConfirmed));
    }
    if (operation === "inventory" && method === "GET") {
      const after = url.searchParams.get("after") ?? "";
      if (after && !/^asset_[a-z0-9_]+$/.test(after)) throw new HttpError(400, "Invalid inventory cursor.");
      return json({ policy: await policyFor(env, projectId), ...(await inventory(env, projectId, after)) });
    }
    if (operation === "audit" && method === "GET") {
      return json({ items: await publicationAudit(env, projectId, url.searchParams.get("limit")) });
    }
    if (operation === "reconcile" && method === "POST") {
      const input = await body(request);
      if (input.confirm !== true || input.rightsConfirmed !== true || !Array.isArray(input.assetIds) || input.assetIds.length > 100 || input.assetIds.length < 1 || input.assetIds.some((item) => typeof item !== "string" || !/^asset_[a-z0-9_]+$/.test(item))) throw new HttpError(400, "Confirm rights and provide 1–100 asset IDs.");
      const policy = await policyFor(env, projectId);
      if (!policy.installationAllowed || !policy.enabled) throw new HttpError(403, "Enable the first-party publication policy for this project first.", "not_allowed");
      const results = [];
      for (const assetId of [...new Set(input.assetIds)]) results.push({ assetId, result: await publishCandidate(env, projectId, assetId) });
      return json({ results });
    }
    if (operation === "backfill" && method === "POST") {
      const input = await body(request);
      const limit = Number(input.limit ?? 10);
      const after = input.after ?? "";
      if (input.confirm !== true || input.rightsConfirmed !== true || !Number.isInteger(limit) || limit < 1 || limit > 25 || (after && (typeof after !== "string" || !/^asset_[a-z0-9_]+$/.test(after)))) throw new HttpError(400, "Confirm rights, then send an optional after cursor and a limit of 1–25.");
      const policy = await policyFor(env, projectId);
      if (!policy.installationAllowed || !policy.enabled) throw new HttpError(403, "Enable the first-party publication policy for this project first.", "not_allowed");
      return json(await boundedBackfill(env, projectId, { limit, after }));
    }
    throw new HttpError(405, "Method not allowed", "method_not_allowed");
  }

  const bulkPublicationsMatch = path.match(/^\/api\/projects\/([a-z0-9_]+)\/publications\/bulk$/);
  if (bulkPublicationsMatch) {
    if (method !== "POST") throw new HttpError(405, "Method not allowed", "method_not_allowed");
    const input = await body(request);
    if (input.confirm !== true) throw new HttpError(400, "Confirm the bulk visibility change.");
    return json(
      await bulkPublicationChange(env, bulkPublicationsMatch[1], {
        action: input.action,
        publicationIds: input.publicationIds,
        session,
      }),
    );
  }

  if (path === "/api/models" && method === "GET")
    return json({ models: publicModels(), retiredModels: publicRetiredModels(), videosConfigured: Boolean(env.FAL_KEY) });

  if (path === "/api/capabilities/refresh" && method === "POST") {
    const result = await refreshCapabilities(env, { force: true });
    return json({
      outcome: result.state.outcome,
      checkedAt: result.state.checkedAt,
      nextDueAt: result.state.nextDueAt,
      openAlerts: result.state.openAlerts,
      modelCalls: 0,
      manifest: result.manifest,
    });
  }

  if (path === "/api/capabilities" && method === "GET")
    return json({ manifest: await readCapabilityManifest(env), state: await readCapabilityState(env) });

  if (path === "/api/state" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all();
    const visible = results.filter((project) => projectAccessible(session, project));
    return json({
      projects: await Promise.all(visible.map((project) => projectSummary(env, project))),
      showcase: await homeShowcase(env),
      models: publicModels(),
      retiredModels: publicRetiredModels(),
      videosConfigured: Boolean(env.FAL_KEY),
      allowanceDefaultMicro: Number(env.MONTHLY_ALLOWANCE_MICRO) || 5_000_000,
      recipes: builtinRecipes,
      destinations: sharingDestinations(env),
      woodhouseShare: env.WOODHOUSE_SHARE === "true",
    });
  }

  if (path.startsWith("/api/studio/")) {
    const posterPreviewMatch = path.match(/^\/api\/studio\/publications\/([a-z0-9_]+)\/poster-preview$/);
    if (posterPreviewMatch && method === "POST") {
      // Rebuild the page-size poster from the publication's own chosen still.
      // With a multipart body the owner's browser supplies the still it already
      // rendered from that poster; without one the Worker tries the Images
      // binding and reports its own refusal. Neither path accepts a still for a
      // different asset or a video frame.
      const publication = await env.DB.prepare(
        `SELECT p.id,p.project_id,p.slug,p.poster_asset_id,p.revoked_at,a.deleted_at AS asset_deleted
         FROM publications p JOIN assets a ON a.id=p.asset_id
         WHERE p.id=?1`,
      )
        .bind(posterPreviewMatch[1])
        .first();
      if (!publication || publication.revoked_at)
        throw new HttpError(404, "Publication not found", "not_found");
      await assertProjectAccess(env, session, publication.project_id);
      if (publication.asset_deleted)
        throw new HttpError(404, "The published media is no longer available", "not_found");
      if (!publication.poster_asset_id)
        throw new HttpError(404, "This page has no chosen poster", "not_found");
      const poster = await env.DB.prepare(
        "SELECT * FROM assets WHERE id=?1 AND project_id=?2 AND kind='image' AND deleted_at IS NULL",
      )
        .bind(publication.poster_asset_id, publication.project_id)
        .first();
      if (!poster) throw new HttpError(404, "This page has no chosen poster", "not_found");
      const type = request.headers.get("content-type") ?? "";
      if (type.includes("multipart/form-data")) {
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) throw new HttpError(400, "Choose a poster preview image to upload");
        if (file.size === 0) throw new HttpError(400, "That poster preview file is empty");
        if (file.size > MAX_DERIVATIVE_BYTES)
          throw new HttpError(413, "A fast preview must stay under 1 MiB", "too_large");
        return json({
          posterPreview: await storePosterUpload(env, publication, poster, new Uint8Array(await file.arrayBuffer())),
        });
      }
      return json({ posterPreview: await storePosterDerivative(env, publication, poster) });
    }
    const assetPreviewMatch = path.match(/^\/api\/studio\/assets\/([a-z0-9_]+)\/preview$/);
    if (assetPreviewMatch) {
      // Private library preview: never public, never referenced by a page.
      const asset = await env.DB.prepare(
        "SELECT * FROM assets WHERE id=?1",
      )
        .bind(assetPreviewMatch[1])
        .first();
      if (!asset) throw new HttpError(404, "No preview for this asset", "not_found");
      await assertProjectAccess(env, session, asset.project_id);
      if (asset.deleted_at || asset.kind !== "image")
        throw new HttpError(404, "No preview for this asset", "not_found");
      if (method === "POST") {
        // The owner's browser may supply the still it rendered from this same
        // asset, because a legacy-billing Images binding refuses the server
        // rendition. It is validated exactly like an uploaded still.
        const type = request.headers.get("content-type") ?? "";
        if (!type.includes("multipart/form-data"))
          throw new HttpError(415, "Upload the preview as form data", "unsupported_media_type");
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) throw new HttpError(400, "Choose a preview image to upload");
        if (file.size === 0) throw new HttpError(400, "That preview file is empty");
        if (file.size > MAX_DERIVATIVE_BYTES)
          throw new HttpError(413, "A fast preview must stay under 1 MiB", "too_large");
        return json({ preview: await storeAssetPreviewUpload(env, asset, new Uint8Array(await file.arrayBuffer())) });
      }
      if (method !== "GET" && method !== "HEAD")
        throw new HttpError(405, "Method not allowed", "method_not_allowed");
      const preview = await readAssetPreview(env, asset.id);
      if (!preview || preview.source_sha256 !== asset.sha256)
        throw new HttpError(404, "No preview for this asset", "not_found");
      const previewEtag = `"${preview.sha256.slice(0, 32)}"`;
      return new Response(method === "HEAD" ? null : preview.object.body, {
        headers: {
          "content-type": preview.mime,
          "content-length": String(preview.bytes),
          etag: previewEtag,
          "cache-control": "private, max-age=0, no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
          "referrer-policy": "no-referrer",
        },
      });
    }
    // Restore and installation-wide inventory belong to the standalone owner.
    // The two preview routes above are project-scoped, so a bridged owner keeps
    // their own library previews and their own poster previews.
    if (session.mode !== "owner")
      throw new HttpError(403, "Portable project restore and inventory are installation-owner actions. Use the standalone owner session.", "owner_required");
    if (path === "/api/studio/previews/backfill" && method === "POST") {
      const input = await body(request, 4096);
      if (input.kind !== "posters" && input.kind !== "assets")
        throw new HttpError(400, "Send kind as posters or assets", "invalid");
      const requested = input.limit === undefined ? 10 : input.limit;
      if (!Number.isInteger(requested) || requested < 1 || requested > 20)
        throw new HttpError(400, "Send a limit from 1 to 20", "invalid");
      return json(await backfillPreviews(env, session, input.kind, requested));
    }
    const limit = Number(env.STUDIO_PORTABLE_STORAGE_LIMIT_BYTES) || null;
    if (path === "/api/studio/imports" && method === "GET") {
      const projectId = url.searchParams.get("projectId");
      if (projectId && !/^[a-z0-9_]+$/.test(projectId)) throw new HttpError(400, "Invalid project id.");
      return json(await portableInventory(env, { projectId: projectId || null }));
    }
    if (path === "/api/studio/restore/preview" && method === "POST") {
      const input = await body(request, 2 * 1024 * 1024);
      return json(await previewPortableImport(env, input.manifest, { storageLimitBytes: limit }));
    }
    if (path === "/api/studio/restore" && method === "POST") {
      const input = await body(request, 2 * 1024 * 1024);
      return json(await beginPortableImport(env, input.manifest, { dryRun: input.dryRun === true, storageLimitBytes: limit }), 202);
    }
    const cleanupMatch = path.match(/^\/api\/studio\/restore\/([a-z0-9_]+)\/cleanup$/);
    if (cleanupMatch && method === "POST") {
      const input = await body(request, 4096);
      return json(await cleanupPortableImport(env, cleanupMatch[1], { confirm: input.confirm === true }));
    }
    const commitMatch = path.match(/^\/api\/studio\/restore\/([a-z0-9_]+)\/commit$/);
    if (commitMatch && method === "POST") {
      const input = await body(request, 4096);
      return json(await commitPortableImport(env, commitMatch[1], { confirm: input.confirm === true }));
    }
    const stageMatch = path.match(/^\/api\/studio\/restore\/([a-z0-9_]+)\/assets\/([a-z0-9_]+)$/);
    if (stageMatch && method === "POST") {
      const bytes = await rawPortableBody(request);
      return json(await stagePortableAsset(env, stageMatch[1], stageMatch[2], bytes));
    }
    const statusMatch = path.match(/^\/api\/studio\/restore\/([a-z0-9_]+)$/);
    if (statusMatch && method === "GET") return json(await importStatus(env, statusMatch[1]));
    throw new HttpError(404, "Restore route not found", "not_found");
  }

  if (path === "/api/projects" && method === "POST") {
    const input = await body(request);
    const name = text(input.name, 80, "Studio name");
    const creativeDirection = text(input.creativeDirection ?? "", 600, "Creative direction", { required: false });
    const visibility = input.visibility === "unlisted" ? "unlisted" : "private";
    const projectId = id("prj");
    const timestamp = now();
    // A project created through a Composer handoff belongs to that workspace.
    // A standalone owner session keeps creating installation-owned projects.
    const workspaceId = session.mode === "owner" ? null : session.workspace;
    await env.DB.prepare(
      "INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,workspace_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
    )
      .bind(projectId, name, slug(8), creativeDirection, visibility, JSON.stringify(defaultDefaults()), workspaceId, timestamp, timestamp)
      .run();
    const project = await loadProject(env, projectId);
    return json({ project: await projectSummary(env, project) }, 201);
  }

  const projectMatch = path.match(/^\/api\/projects\/([a-z0-9_]+)(?:\/(.+))?$/);
  if (projectMatch) {
    const [, projectId, rest] = projectMatch;
    const project = await loadProject(env, projectId);

    if (!rest && method === "GET") {
      const assets = await env.DB.prepare("SELECT * FROM assets WHERE project_id=?1 AND deleted_at IS NULL ORDER BY created_at DESC")
        .bind(project.id)
        .all();
      const previewRows = await env.DB.prepare("SELECT asset_id,source_sha256 FROM asset_previews WHERE project_id=?1")
        .bind(project.id)
        .all();
      const previewSource = new Map(previewRows.results.map((row) => [row.asset_id, row.source_sha256]));
      const generations = await env.DB.prepare("SELECT * FROM generations WHERE project_id=?1 ORDER BY created_at DESC LIMIT 40")
        .bind(project.id)
        .all();
      const recipes = await env.DB.prepare("SELECT * FROM recipes WHERE project_id=?1 ORDER BY created_at ASC")
        .bind(project.id)
        .all();
      const publications = await env.DB.prepare(
        `SELECT p.*,(d.publication_id IS NOT NULL) AS has_thumb,
                (pd.publication_id IS NOT NULL AND pd.source_sha256=poster.sha256) AS has_poster_preview
         FROM publications p
         LEFT JOIN publication_derivatives d ON d.publication_id=p.id AND d.kind='thumb'
         LEFT JOIN assets poster ON poster.id=p.poster_asset_id AND poster.project_id=p.project_id
           AND poster.kind='image' AND poster.deleted_at IS NULL
         LEFT JOIN publication_derivatives pd ON pd.publication_id=p.id AND pd.kind='poster'
         WHERE p.project_id=?1 AND p.revoked_at IS NULL ORDER BY p.created_at DESC`,
      )
        .bind(project.id)
        .all();
      // Reuse resolves from stored relationships and the same-project library.
      // The history list above is bounded for display; read every generation's
      // reference so an older clip can still find its retained still.
      const reuseRows = await env.DB.prepare(
        "SELECT id,output_asset_id,request_json FROM generations WHERE project_id=?1",
      )
        .bind(project.id)
        .all();
      const generationReferences = reuseRows.results.map((row) => ({
        id: row.id,
        assetId: row.output_asset_id,
        referenceAssetId: safeJson(row.request_json, {}).referenceAssetId ?? null,
      }));
      const assetRows = assets.results;
      const receiptRows = await env.DB.prepare("SELECT r.output_asset_id FROM local_render_receipts r JOIN assets a ON a.id=r.output_asset_id AND a.project_id=r.project_id WHERE r.project_id=?1 AND a.deleted_at IS NULL").bind(project.id).all();
      const receiptAssetIds = new Set(receiptRows.results.map(row => row.output_asset_id));
      const reuseById = new Map(
        assetRows.map((asset) => [
          asset.id,
          reuseStillFor({
            asset,
            assets: assetRows,
            generations: generationReferences,
            publications: publications.results,
          }),
        ]),
      );
      const compositions = await env.DB.prepare(
        "SELECT * FROM compositions WHERE project_id=?1 ORDER BY created_at DESC",
      )
        .bind(project.id)
        .all();
      const renderRows = await env.DB.prepare(
        "SELECT * FROM generations WHERE project_id=?1 AND composition_id IS NOT NULL ORDER BY created_at ASC",
      )
        .bind(project.id)
        .all();
      const rendersByComposition = new Map();
      for (const row of renderRows.results) {
        const list = rendersByComposition.get(row.composition_id) ?? [];
        list.push(generationView(row));
        rendersByComposition.set(row.composition_id, list);
      }
      return json({
        project: await projectSummary(env, project),
        assets: assetRows.map((asset) =>
          assetView(asset, {
            reuseStillId: reuseById.get(asset.id)?.id ?? null,
            hasLocalRenderReceipt: receiptAssetIds.has(asset.id),
            hasPreview: previewSource.get(asset.id) === asset.sha256,
          }),
        ),
        compositions: compositions.results.map((composition) => ({
          id: composition.id,
          title: composition.title,
          createdAt: composition.created_at,
          updatedAt: composition.updated_at,
          ...safeJson(composition.spec_json, { shots: [], audioAssetId: null, totalMs: 0 }),
          renders: rendersByComposition.get(composition.id) ?? [],
        })),
        generations: generations.results.map((generation) => generationView(generation)),
        recipes: projectRecipes(project.id, recipes.results),
        publications: publications.results.map((publication) => ({
          id: publication.id,
          slug: publication.slug,
          title: publication.title,
          description: publication.description,
          assetId: publication.asset_id,
          posterAssetId: publication.poster_asset_id,
          listed: Boolean(publication.listed),
          hidden: Boolean(publication.hidden),
          hasThumb: Boolean(publication.has_thumb),
          hasPosterPreview: Boolean(publication.has_poster_preview),
          review:
            publication.review_room_id && publication.review_decision === "approved"
              ? {
                  roomId: publication.review_room_id,
                  decision: publication.review_decision,
                  assetSha256: publication.review_asset_sha256,
                }
              : null,
          path: `/p/${publication.slug}`,
          createdAt: publication.created_at,
        })),
        budget: await budgetSnapshot(env, project.id),
      });
    }

    if (!rest && method === "PATCH") {
      const input = await body(request);
      const name = input.name === undefined ? project.name : text(input.name, 80, "Studio name");
      const direction =
        input.creativeDirection === undefined
          ? project.creative_direction
          : text(input.creativeDirection, 600, "Creative direction", { required: false });
      const visibility = input.visibility === undefined ? project.visibility : input.visibility === "unlisted" ? "unlisted" : "private";
      const references =
        input.references === undefined
          ? safeJson(project.references_json, [])
          : normalizeReferences(input.references);
      const defaults = input.defaults === undefined ? safeJson(project.defaults_json, {}) : input.defaults;
      await env.DB.prepare(
        "UPDATE projects SET name=?2,creative_direction=?3,visibility=?4,defaults_json=?5,references_json=?6,updated_at=?7 WHERE id=?1",
      )
        .bind(project.id, name, direction, visibility, JSON.stringify(defaults), JSON.stringify(references), now())
        .run();
      return json({ project: await projectSummary(env, await loadProject(env, project.id)) });
    }

    if (rest === "assets/loftwahfm" && method === "POST") {
      const input = await body(request);
      if (input?.rightsConfirmed !== true)
        throw new HttpError(400, "Confirm you have permission to use this track.", "rights_required");
      const track = await readLoftwahFmTrack(input.url, MAX_AUDIO_BYTES);
      await requireSession(env, request, "edit");
      await assertProjectAccess(env, session, project.id);
      const hash = await sha256Hex(track.bytes);
      const identity = await sha256Hex(new TextEncoder().encode(JSON.stringify([project.id, track.source, hash])));
      const importId = "asset_" + identity;
      const existing = await env.DB.prepare("SELECT * FROM assets WHERE id=?1 AND project_id=?2").bind(importId, project.id).first();
      if (existing?.deleted_at) throw new HttpError(409, "This imported track was previously removed from this project.", "removed_track");
      if (existing) return json({ asset: assetView(existing) });
      return storeAsset(env, project, track.bytes, {
        mime: "audio/mpeg", title: track.title, caption: track.source, importId, hash,
      });
    }

    if (rest === "assets/woodhouse" && method === "GET" && env.WOODHOUSE_SHARE === "true") {
      const query = url.searchParams.get("q")?.trim() ?? "";
      if (!query || query.length > 100 || url.searchParams.size !== 1)
        throw new HttpError(400, "Enter one artwork query of up to 100 characters.");
      let page;
      try {
        page = await sharePage(new URLSearchParams({ q: query }), 8);
      } catch {
        throw new HttpError(502, "Woodhouse Share is unavailable. Try again in a moment.");
      }
      return json({
        readOnly: true,
        // Only approved public fields cross this boundary. An optional upstream
        // thumbnail is kept only when it passes the fixed-origin check; otherwise
        // the result stays text-only. The sharePage(..., 8) bound is unchanged.
        assets: page.assets.flatMap(({ id, title, project: shareProject, thumbnailUrl }) => {
          if (typeof title !== "string" || title.length > 200 || typeof shareProject !== "string" || shareProject.length > 128) return [];
          const image = woodhouseUrl(thumbnailUrl);
          return [image ? { id, title, project: shareProject, thumbnailUrl: image } : { id, title, project: shareProject }];
        }),
      });
    }

    if (rest === "assets/woodhouse" && method === "POST" && env.WOODHOUSE_SHARE === "true") {
      const input = await body(request);
      if (input.reuseConfirmed !== true)
        throw new HttpError(400, "Confirm permission to reuse this original.");
      return importWoodhouseAsset(env, project, input.assetId);
    }

    if (rest === "assets/preflight" && method === "POST") {
      const lookup = await findDuplicateOriginal(env, project, await body(request, 4096));
      if (!lookup.valid) throw new HttpError(400, lookup.reason, "invalid_fingerprint");
      return json({
        readOnly: true,
        writes: 0,
        projectId: project.id,
        match: "sha256+size+mime",
        filenameUsed: false,
        fingerprint: lookup.fingerprint,
        duplicate: lookup.duplicate
          ? assetView(lookup.duplicate, {
              duplicate: true,
              reuse: { assetId: lookup.duplicate.id, href: `/api/projects/${project.id}/assets/reuse` },
            })
          : null,
        note: lookup.duplicate
          ? "This project already has the same bytes, size and media type. Reusing returns that saved original without copying bytes or changing its lineage."
          : "No live saved original in this project matches those exact bytes, size and media type.",
      });
    }

    if (rest === "assets/reuse" && method === "POST") {
      const input = await body(request, 4096);
      const assetId = String(input.assetId ?? "");
      if (!/^[a-z0-9_]{4,80}$/i.test(assetId)) throw new HttpError(400, "Choose a saved original from this project.", "invalid_asset");
      const lookup = await findDuplicateOriginal(env, project, input);
      if (!lookup.valid) throw new HttpError(400, lookup.reason, "invalid_fingerprint");
      if (!lookup.duplicate || lookup.duplicate.id !== assetId)
        throw new HttpError(409, "That original no longer matches this project's saved file. Upload the file again or choose the current original.", "duplicate_not_found");
      return json({ readOnly: true, writes: 0, reused: true, asset: assetView(lookup.duplicate) });
    }

    const assetUsesMatch = rest && rest.match(/^assets\/([a-z0-9_]+)\/uses$/);
    if (assetUsesMatch && method === "GET") {
      const usage = await assetUsageReport(env, project, assetUsesMatch[1]);
      if (!usage) throw new HttpError(404, "Asset not found", "not_found");
      return json(usage);
    }

    if (rest === "assets/upload-link" && method === "POST") {
      return json(await beginAssetUpload(env, project, session, await body(request, 4096), request));
    }

    if (rest === "assets" && method === "POST") {
      const binding = request.headers.get("x-studio-local-import-binding");
      if (binding !== null && (!/^[a-f0-9]{64}$/.test(binding) || !constantTimeEqual(binding, (await sessionBinding(env, session)) ?? ""))) throw new HttpError(409, "Your Studio session changed. Choose a studio again.", "session_changed");
      return uploadAsset(request, env, project);
    }

    if (rest === "promo-briefs" && method === "GET") return json({ briefs: await listPromoBriefs(env, project) });
    if (rest === "promo-briefs" && method === "POST") return json({ brief: await createPromoBrief(env, project, await body(request)) }, 201);
    const promoBriefMatch = rest && rest.match(/^promo-briefs\/([a-z0-9_]+)$/);
    if (promoBriefMatch && method === "PATCH") return json({ brief: await updatePromoBrief(env, project, promoBriefMatch[1], await body(request)) });

    if (rest === "subjects" && method === "GET") return json({ subjects: await listSubjects(env, project) });
    if (rest === "subjects" && method === "POST") return json({ subject: await saveSubject(env, project, await body(request)) }, 201);
    const subjectMatch = rest && rest.match(/^subjects\/([a-z0-9_]+)$/);
    if (subjectMatch && method === "GET") return json({ versions: await subjectVersions(env, project, subjectMatch[1]) });
    if (subjectMatch && method === "PATCH") return json({ subject: await saveSubject(env, project, await body(request), subjectMatch[1]) });

    if (rest === "review-rooms" && method === "GET") return json({ rooms: await listReviewRooms(env, project) });
    if (rest === "review-rooms" && method === "POST") {
      const created = await createReviewRoom(env, project, await body(request));
      return json(
        {
          room: ownerReviewRoomView(created.room),
          reviewUrl: `/r/${created.token}`,
        },
        201,
      );
    }
    if (rest === "review-rooms/compare" && method === "GET") {
      const left = new URL(request.url).searchParams.get("left") ?? "";
      const right = new URL(request.url).searchParams.get("right") ?? "";
      if (!/^[a-z0-9_]+$/.test(left) || !/^[a-z0-9_]+$/.test(right))
        throw new HttpError(400, "Choose two saved review versions", "review_compare_invalid");
      return json(await compareReviewRooms(env, project, left, right));
    }
    const reviewFeedbackMatch = rest && rest.match(/^review-rooms\/([a-z0-9_]+)\/feedback\/([a-z0-9_]+)$/);
    if (reviewFeedbackMatch && method === "PATCH")
      return json({ feedback: await setFeedbackResolved(env, project, reviewFeedbackMatch[1], reviewFeedbackMatch[2], await body(request)) });
    const reviewRoomMatch = rest && rest.match(/^review-rooms\/([a-z0-9_]+)(?:\/(revoke|rotate))?$/);
    if (reviewRoomMatch && method === "POST" && reviewRoomMatch[2] === "revoke")
      return json({ room: await revokeReviewRoom(env, project, reviewRoomMatch[1]) });
    if (reviewRoomMatch && method === "POST" && reviewRoomMatch[2] === "rotate") {
      const rotated = await rotateReviewRoomToken(env, project, reviewRoomMatch[1]);
      return json({ room: rotated.room, reviewUrl: `/r/${rotated.token}` });
    }

    if (rest === "footage-plans" && method === "GET") return json({ plans: await listFootagePlans(env, project) });
    if (rest === "footage-plans" && method === "POST") return json({ plan: await createFootagePlan(env, project, await body(request)) }, 201);
    const footageReceiptStart = rest && rest.match(/^footage-plans\/([a-z0-9_]+)\/export-receipts$/);
    if (footageReceiptStart && method === "POST") return json({ receipt: await createFootageExportReceipt(env, project, footageReceiptStart[1], await body(request, 4096)) }, 201);
    const footagePlanEdit = rest && rest.match(/^footage-plans\/([a-z0-9_]+)$/);
    if (footagePlanEdit && method === "PATCH") return json({ plan: await updateFootagePlan(env, project, footagePlanEdit[1], await body(request)) });

    if (rest === "song-plans/import" && method === "POST") {
      const binding=request.headers.get("x-studio-local-import-binding") ?? "";
      if (!/^[a-f0-9]{64}$/.test(binding) || !constantTimeEqual(binding,(await sessionBinding(env,session)) ?? "")) throw new HttpError(409,"Your Studio session changed. Review the import again.","session_changed");
      return json({ plan: await importSongPlan(env, project, await body(request)) }, 201);
    }
    if (rest === "song-plans" && method === "GET") return json({ plans: await listSongPlans(env, project) });
    if (rest === "song-plans" && method === "POST") return json({ plan: await createSongPlan(env, project, await body(request)) }, 201);
    const sceneProposal = rest && rest.match(/^song-plans\/([a-z0-9_]+)\/scene-proposal\/(preview|apply)$/);
    const directorProposal = rest && rest.match(/^song-plans\/([a-z0-9_]+)\/director$/);
    const shotDiagnosis = rest && rest.match(/^song-plans\/([a-z0-9_]+)\/shot-diagnosis$/);
    if (directorProposal && method === "POST") return json(await proposeSceneDirection(env, project, directorProposal[1], await body(request, 8192)));
    if (shotDiagnosis && method === "POST") return json(await diagnoseShots(env, project, shotDiagnosis[1], await body(request, 8192)));
    if (sceneProposal && method === "POST") {
      const input=await body(request,16384);
      return json(sceneProposal[2] === "preview" ? await previewSceneProposal(env,project,sceneProposal[1],input) : await applySceneProposal(env,project,sceneProposal[1],input));
    }
    const songStoryboard = rest && rest.match(/^song-plans\/([a-z0-9_]+)\/storyboard$/);
    if (songStoryboard && method === "POST") {
      const result = await createStoryboardFromSongPlan(env, project, songStoryboard[1], await body(request));
      return json(result, result.created ? 201 : 200);
    }
    const songCaptions = rest && rest.match(/^song-plans\/([a-z0-9_]+)\/captions$/);
    if (songCaptions && method === "PATCH") return json({ plan: await updateSongCaptions(env, project, songCaptions[1], await body(request)) });
    if (songCaptions && method === "GET") {
      const params = new URL(request.url).searchParams;
      const result = await exportSongCaptions(env, project, songCaptions[1], params.get("format"));
      if (params.get("download") === "1") return new Response(result.content, { headers: { "content-type": result.format === "vtt" ? "text/vtt; charset=utf-8" : "application/x-subrip; charset=utf-8", "content-disposition": `attachment; filename="captions.${result.format}"`, "cache-control": "no-store" } });
      return json(result);
    }
    const songPlanEdit = rest && rest.match(/^song-plans\/([a-z0-9_]+)$/);
    if (songPlanEdit && method === "PATCH") return json({ plan: await updateSongPlan(env, project, songPlanEdit[1], await body(request)) });

    if (rest === "compositions" && method === "POST") {
      const input = await body(request);
      return json({ composition: await createComposition(env, project, input) }, 201);
    }

    const receiptStart = rest && rest.match(/^compositions\/([a-z0-9_]+)\/local-render-receipts$/);
    if (receiptStart && method === "POST") return json({ receipt: await createLocalRenderReceipt(env, project, receiptStart[1], await body(request, 4096)) }, 201);
    const compositionEdit = rest && rest.match(/^compositions\/([a-z0-9_]+)$/);
    if (compositionEdit && method === "PATCH") {
      const composition = await env.DB.prepare("SELECT * FROM compositions WHERE id=?1 AND project_id=?2")
        .bind(compositionEdit[1], project.id)
        .first();
      if (!composition) throw new HttpError(404, "Composition not found", "not_found");
      const input = await body(request);
      return json({ composition: await updateComposition(env, project, composition, input) });
    }

    const compositionRender = rest && rest.match(/^compositions\/([a-z0-9_]+)\/render$/);
    if (compositionRender && method === "POST") {
      const composition = await env.DB.prepare("SELECT * FROM compositions WHERE id=?1 AND project_id=?2")
        .bind(compositionRender[1], project.id)
        .first();
      if (!composition) throw new HttpError(404, "Composition not found", "not_found");
      const input = await body(request);
      const created = await createRender(env, project, composition, input);
      if (!created.created) {
        const generation =
          created.generation.status === "admitted"
            ? await retainDispatch(ctx, dispatchRender(env, created.generation))
            : created.generation;
        return json({ generation: generationView(generation), replayed: true, budget: await budgetSnapshot(env, project.id) });
      }
      const generation = await retainDispatch(ctx, dispatchRender(env, created.generation));
      return json(
        {
          generation: generationView(generation),
          budget: await budgetSnapshot(env, project.id),
          estimateMicro: created.generation.cost_estimate_micro,
        },
        201,
      );
    }

    if (rest === "generations" && method === "POST") {
      const input = await body(request);
      const created = await createGeneration(env, project, input);
      if (!created.created) {
        const generation =
          created.generation.status === "admitted"
            ? await retainDispatch(ctx, dispatchGeneration(env, created.generation))
            : created.generation;
        return json({ generation: generationView(generation), replayed: true, budget: await budgetSnapshot(env, project.id) });
      }
      const generation = await retainDispatch(ctx, dispatchGeneration(env, created.generation));
      return json(
        {
          generation: generationView(generation),
          budget: await budgetSnapshot(env, project.id),
          estimateMicro: created.generation.cost_estimate_micro,
        },
        201,
      );
    }

    if (rest === "portable-export" && method === "GET") {
      const manifest = await exportProjectManifest(env, project);
      return new Response(JSON.stringify(manifest, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${project.slug}-studio-project-manifest.json"`,
          "cache-control": "no-store",
        },
      });
    }

    if (rest === "storage-report" && method === "GET") {
      const report = await projectStorageReport(env, project);
      return json(report, 200, url.searchParams.get("download") === "1"
        ? { "content-disposition": `attachment; filename="${project.slug}-storage-report.json"` }
        : {});
    }

    if (rest === "export" && method === "GET") {
      const assets = await env.DB.prepare("SELECT * FROM assets WHERE project_id=?1 ORDER BY created_at ASC").bind(project.id).all();
      const generations = await env.DB.prepare("SELECT * FROM generations WHERE project_id=?1 ORDER BY created_at ASC").bind(project.id).all();
      const recipes = await env.DB.prepare("SELECT * FROM recipes WHERE project_id=?1").bind(project.id).all();
      const publications = await env.DB.prepare("SELECT * FROM publications WHERE project_id=?1").bind(project.id).all();
      const payload = {
        format: "media-studio.export/v1",
        exportedAt: new Date().toISOString(),
        build: BUILD.revision,
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug,
          creativeDirection: project.creative_direction,
          visibility: project.visibility,
          references: safeJson(project.references_json, []),
          defaults: safeJson(project.defaults_json, {}),
          createdAt: project.created_at,
          updatedAt: project.updated_at,
        },
        assets: assets.results.map((asset) => ({
          ...assetView(asset),
          deletedAt: asset.deleted_at,
          r2Key: asset.r2_key,
          downloadPath: `/api/assets/${asset.id}/download`,
        })),
        generations: generations.results.map((generation) => ({
          ...generationView(generation),
          request: safeJson(generation.request_json, {}),
          provider: generation.provider,
          providerRequestId: generation.provider_request_id,
        })),
        recipes: recipes.results.map((recipe) => ({
          id: recipe.id,
          slug: recipe.slug,
          title: recipe.title,
          description: recipe.description,
          kind: recipe.kind,
          promptTemplate: recipe.prompt_template,
          controls: safeJson(recipe.controls_json, []),
          version: recipe.version,
        })),
        publications: publications.results.map((publication) => ({
          id: publication.id,
          slug: publication.slug,
          assetId: publication.asset_id,
          posterAssetId: publication.poster_asset_id,
          title: publication.title,
          description: publication.description,
          createdAt: publication.created_at,
          revokedAt: publication.revoked_at,
        })),
        subjects: await listSubjects(env, project, true),
        songPlans: await listSongPlans(env, project),
        promoBriefs: await listPromoBriefs(env, project),
        notes: [
          "Studio provider keys and session cookies are not included; project text and links may contain sensitive information.",
          "Cost figures reflect Studio estimates and reservations, not verified provider invoice charges; the legacy costAllocatedMicro field is an allocated estimate.",
          "Song plans may contain private lyrics, scene directions and subject and reference history. Share this file deliberately.",
          "This export is not a restore: project import is not supported.",
          "Media bytes are downloaded separately from each asset's download path while it exists.",
          "An export is not a backup of R2: copy the files you need while the studio still serves them.",
        ],
      };
      return new Response(JSON.stringify(payload, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${project.slug}-media-studio-export.json"`,
          "cache-control": "no-store",
        },
      });
    }

    if (rest === "recipes" && method === "POST") {      const input = await body(request);
      const slugValue = text(input.slug ?? "", 60, "Recipe id", { required: false }) || `custom-${Date.now()}`;
      const title = text(input.title, 80, "Recipe title");
      const description = text(input.description ?? "", 240, "Description", { required: false });
      const promptTemplate = text(input.promptTemplate, 1800, "Prompt template");
      const kind = input.kind === "video" ? "video" : "image";
      const recipeId = id("rcp");
      await env.DB.prepare(
        "INSERT INTO recipes(id,project_id,slug,title,description,kind,prompt_template,controls_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
      )
        .bind(recipeId, project.id, slugValue, title, description, kind, promptTemplate, JSON.stringify(input.controls ?? []), now())
        .run();
      return json({ id: recipeId }, 201);
    }
  }

  const assetMatch = path.match(/^\/api\/assets\/([a-z0-9_]+)(?:\/(file|download|publish|local-render-receipt|footage-export-receipt|footage-preflight))?$/);
  if (assetMatch) {
    const [, assetId, action] = assetMatch;
    const asset = await env.DB.prepare(
      "SELECT a.*,p.workspace_id AS project_workspace_id FROM assets a JOIN projects p ON p.id=a.project_id WHERE a.id=?1",
    )
      .bind(assetId)
      .first();
    if (!asset) throw new HttpError(404, "Asset not found", "not_found");
    if (!projectAccessible(session, { id: asset.project_id, workspace_id: asset.project_workspace_id }))
      throw new HttpError(403, "This asset belongs to another workspace or to a different studio link.", "forbidden");

    if (action === "footage-preflight" && method === "GET") return json({ measurement: await measureFootageSource(env, asset) });

    if (action === "footage-export-receipt" && method === "GET") {
      if (asset.deleted_at) throw new HttpError(404, "Asset not found", "not_found");
      const receipt = await env.DB.prepare("SELECT snapshot_json,created_at FROM footage_export_receipts WHERE output_asset_id=?1 AND project_id=?2").bind(asset.id,asset.project_id).first();
      if (!receipt) throw new HttpError(404, "No footage export receipt for this asset", "not_found");
      return json({ receipt: { ...safeJson(receipt.snapshot_json, {}), createdAt: receipt.created_at, output: { assetId: asset.id, sha256: asset.sha256, bytes: asset.bytes, mime: asset.mime } } });
    }

    if (action === "local-render-receipt" && method === "GET") {
      if (asset.deleted_at) throw new HttpError(404, "Asset not found", "not_found");
      const receipt = await env.DB.prepare("SELECT snapshot_json,created_at FROM local_render_receipts WHERE output_asset_id=?1 AND project_id=?2").bind(asset.id,asset.project_id).first();
      if (!receipt) throw new HttpError(404, "No local render receipt for this asset", "not_found");
      return json({ receipt: { ...safeJson(receipt.snapshot_json, {}), createdAt: receipt.created_at, output: { assetId: asset.id, sha256: asset.sha256, bytes: asset.bytes, mime: asset.mime } } });
    }

    if (!action && method === "GET") {
      const receipt = await env.DB.prepare("SELECT id FROM local_render_receipts WHERE output_asset_id=?1 AND project_id=?2").bind(asset.id,asset.project_id).first();
      return json({ asset: assetView(asset, { hasLocalRenderReceipt: Boolean(receipt) }) });
    }


    if (!action && method === "PATCH") {
      if (asset.deleted_at) throw new HttpError(410, "This asset was deleted", "deleted");
      const input = await body(request);
      const title = input.title === undefined ? asset.title : text(input.title, 100, "Title", { required: false });
      const caption = input.caption === undefined ? asset.caption : text(input.caption, 400, "Caption", { required: false });
      await env.DB.prepare("UPDATE assets SET title=?2,caption=?3,updated_at=?4 WHERE id=?1 AND deleted_at IS NULL")
        .bind(asset.id, title, caption, now())
        .run();
      const receipt = await env.DB.prepare("SELECT id FROM local_render_receipts WHERE output_asset_id=?1 AND project_id=?2").bind(asset.id,asset.project_id).first();
      return json({ asset: assetView(await env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(asset.id).first(), { hasLocalRenderReceipt: Boolean(receipt) }) });
    }

    if (!action && method === "DELETE") {
      const timestamp = now();
      const affected = await env.DB.prepare(
        "SELECT id FROM publications WHERE (asset_id=?1 OR poster_asset_id=?1) AND revoked_at IS NULL",
      )
        .bind(asset.id)
        .all();
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE assets SET deleted_at=COALESCE(deleted_at,?2),delete_revision=delete_revision+(deleted_at IS NULL),erasure_pending=1,updated_at=?2 WHERE id=?1",
        ).bind(asset.id, timestamp),
        env.DB.prepare(
          "UPDATE publications SET revoked_at=?2 WHERE (asset_id=?1 OR poster_asset_id=?1) AND revoked_at IS NULL",
        ).bind(asset.id, timestamp),
      ]);
      try {
        await deletePublicationDerivatives(env, affected.results.map((row) => row.id));
      } catch (error) {
        console.warn("Could not remove previews for a deleted asset", asset.id, error?.message);
      }
      await eraseAsset(env, asset);
      return json({ deleted: true, ...(asset.deleted_at ? { alreadyDeleted: true } : {}) });
    }

    if (action === "file" && (method === "GET" || method === "HEAD")) {
      if (asset.deleted_at) throw new HttpError(410, "This asset was deleted", "deleted");
      const range = parseRange(request.headers.get("range"), asset.bytes);
      if (range?.invalid)
        return new Response(null, {
          status: 416,
          headers: { "content-range": `bytes */${asset.bytes}`, "accept-ranges": "bytes" },
        });
      const object = await env.MEDIA.get(
        asset.r2_key,
        range ? { range: { offset: range.offset, length: range.length } } : undefined,
      );
      if (!object) throw new HttpError(410, "The stored bytes are unavailable", "unavailable");
      return new Response(method === "HEAD" ? null : object.body, {
        status: range ? 206 : 200,
        headers: {
          "content-type": asset.mime,
          ...rangeHeaders(range, asset.bytes),
          "cache-control": "private, max-age=300",
          etag: `"${asset.sha256.slice(0, 32)}"`,
        },
      });
    }

    if (action === "download" && method === "GET") {
      if (asset.deleted_at) throw new HttpError(410, "This asset was deleted", "deleted");
      const range = parseRange(request.headers.get("range"), asset.bytes);
      if (range?.invalid)
        return new Response(null, {
          status: 416,
          headers: { "content-range": `bytes */${asset.bytes}`, "accept-ranges": "bytes" },
        });
      const object = await env.MEDIA.get(
        asset.r2_key,
        range ? { range: { offset: range.offset, length: range.length } } : undefined,
      );
      if (!object) throw new HttpError(410, "The stored bytes are unavailable", "unavailable");
      return new Response(object.body, {
        status: range ? 206 : 200,
        headers: {
          "content-type": asset.mime,
          ...rangeHeaders(range, asset.bytes),
          "content-disposition": `attachment; filename="media-${asset.id}.${extensionFor(asset.mime)}"`,
          "cache-control": "private, no-store",
        },
      });
    }

    if (action === "publish" && method === "POST") {
      if (asset.deleted_at) throw new HttpError(410, "This asset was deleted", "deleted");
      const input = await body(request);
      await checkPublicImage(env, asset);
      const title = text(input.title ?? asset.title, 100, "Public title");
      const description = text(input.description ?? "", 300, "Public description", { required: false });
      let posterAssetId = null;
      let posterAsset = null;
      if (asset.kind === "video" && input.posterAssetId) {
        const poster = await env.DB.prepare(
          "SELECT * FROM assets WHERE id=?1 AND project_id=?2 AND kind='image' AND deleted_at IS NULL",
        )
          .bind(String(input.posterAssetId), asset.project_id)
          .first();
        if (poster) await checkPublicImage(env, poster);
        posterAssetId = poster?.id ?? null;
        posterAsset = poster ?? null;
      }
      // If this exact saved version was approved in a private review, record
      // that decision on the publication. It is provenance, not permission:
      // publishing stays a separate deliberate action and older assets without
      // a review publish exactly as before.
      const approval = await env.DB.prepare(
        `SELECT id, asset_sha256 FROM review_rooms
         WHERE project_id=?1 AND asset_id=?2 AND asset_sha256=?3 AND decision='approved' AND revoked_at IS NULL
         ORDER BY decided_at DESC LIMIT 1`,
      )
        .bind(asset.project_id, asset.id, asset.sha256)
        .first();
      const publicationId = id("pub");
      const publicSlug = slug(12);
      await env.DB.prepare(
        `INSERT INTO publications(id,project_id,asset_id,poster_asset_id,slug,title,description,asset_revision,created_at,review_room_id,review_decision,review_asset_sha256)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
      )
        .bind(
          publicationId,
          asset.project_id,
          asset.id,
          posterAssetId,
          publicSlug,
          title,
          description,
          asset.delete_revision,
          now(),
          approval?.id ?? null,
          approval ? "approved" : null,
          approval?.asset_sha256 ?? null,
        )
        .run();
      if (posterAsset) {
        // A page's first paint should not be the full poster. This is additive:
        // when Images is unavailable the page keeps its existing full-poster
        // fallback, so publishing must not fail with it.
        try {
          await storePosterDerivative(
            env,
            { id: publicationId, project_id: asset.project_id, slug: publicSlug },
            posterAsset,
          );
        } catch (error) {
          console.warn("Could not build a poster preview", publicationId, error?.code ?? error?.message);
        }
      }
      return json({ publication: { id: publicationId, path: `/p/${publicSlug}`, title, description } }, 201);
    }
  }

  const derivativeMatch = path.match(/^\/api\/publications\/([a-z0-9_]+)\/derivative$/);
  if (derivativeMatch && method === "POST") {
    // A fast preview is derived from a live publication, never from library
    // metadata. Withdrawing the page invalidates it with the page itself.
    const publication = await env.DB.prepare(
      `SELECT p.id,p.project_id,p.slug,a.kind AS asset_kind,a.deleted_at AS asset_deleted
       FROM publications p JOIN assets a ON a.id=p.asset_id
       WHERE p.id=?1 AND p.revoked_at IS NULL`,
    )
      .bind(derivativeMatch[1])
      .first();
    if (!publication) throw new HttpError(404, "Publication not found", "not_found");
    await assertProjectAccess(env, session, publication.project_id);
    if (publication.asset_deleted) throw new HttpError(404, "The published media is no longer available", "not_found");
    if (!["image", "video"].includes(publication.asset_kind))
      throw new HttpError(415, "Only images and films can have a fast preview", "unsupported_type");
    const type = request.headers.get("content-type") ?? "";
    if (!type.includes("multipart/form-data"))
      throw new HttpError(415, "Upload the preview as form data", "unsupported_media_type");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Choose a preview image to upload");
    if (file.size === 0) throw new HttpError(400, "That preview file is empty");
    if (file.size > MAX_DERIVATIVE_BYTES)
      throw new HttpError(413, "A fast preview must stay under 1 MiB", "too_large");
    const stored = await storeDerivative(env, publication, new Uint8Array(await file.arrayBuffer()));
    return json({
      thumb: {
        path: `/p/${publication.slug}/thumb`,
        bytes: stored.bytes,
        width: stored.width,
        height: stored.height,
      },
    });
  }

  const publicationMatch = path.match(/^\/api\/publications\/([a-z0-9_]+)$/);
  if (publicationMatch && method === "PATCH") {
    const input = await body(request);
    const editingText = Object.hasOwn(input, "title") || Object.hasOwn(input, "description");
    if (!editingText && typeof input.listed !== "boolean" && typeof input.hidden !== "boolean") throw new HttpError(400, "Send listed or hidden as a boolean", "invalid");
    const row = await env.DB.prepare("SELECT id,project_id FROM publications WHERE id=?1 AND revoked_at IS NULL").bind(publicationMatch[1]).first();
    if (!row) throw new HttpError(404, "Publication not found", "not_found");
    await assertProjectAccess(env, session, row.project_id);
    if (editingText) {
      if (Object.hasOwn(input, "listed") || Object.hasOwn(input, "hidden") || typeof input.title !== "string" || typeof input.description !== "string" || typeof input.expectedTitle !== "string" || typeof input.expectedDescription !== "string") throw new HttpError(400, "Send the original and new title and description with the edit.", "invalid");
      const title = text(input.title, 100, "Public title");
      const description = text(input.description, 300, "Public description", { required: false });
      const [result] = await env.DB.batch([env.DB.prepare("UPDATE publications SET title=?2,description=?3 WHERE id=?1 AND revoked_at IS NULL AND title=?4 AND description=?5")
        .bind(row.id, title, description, input.expectedTitle, input.expectedDescription)]);
      if (!result.meta.changes) throw new HttpError(409, "This publication changed or was withdrawn. Your edit was not saved.", "revision_conflict");
      return json({ id: row.id, title, description });
    }
    if (typeof input.listed === "boolean" && typeof input.hidden === "boolean") {
      await env.DB.prepare("UPDATE publications SET listed=?2,hidden=?3 WHERE id=?1").bind(row.id, input.listed ? 1 : 0, input.hidden ? 1 : 0).run();
    } else if (typeof input.listed === "boolean") {
      await env.DB.prepare("UPDATE publications SET listed=?2 WHERE id=?1").bind(row.id, input.listed ? 1 : 0).run();
    } else {
      await env.DB.prepare("UPDATE publications SET hidden=?2 WHERE id=?1").bind(row.id, input.hidden ? 1 : 0).run();
    }
    return json({ id: row.id, listed: input.listed, hidden: input.hidden });
  }
  if (publicationMatch && method === "DELETE") {
    const row = await env.DB.prepare("SELECT id,project_id FROM publications WHERE id=?1").bind(publicationMatch[1]).first();
    if (!row) throw new HttpError(404, "Publication not found", "not_found");
    await assertProjectAccess(env, session, row.project_id);
    await env.DB.prepare("UPDATE publications SET revoked_at=?2 WHERE id=?1 AND revoked_at IS NULL")
      .bind(row.id, now())
      .run();
    try {
      await deletePublicationDerivatives(env, [row.id]);
    } catch (error) {
      // The page is already withdrawn, and /p/:slug/thumb checks that first.
      console.warn("Could not remove a withdrawn publication preview", row.id, error?.message);
    }
    return json({ revoked: true });
  }

  const generationMatch = path.match(/^\/api\/generations\/([a-z0-9_]+)(?:\/(cancel|reconcile|save-retry))?$/);
  if (generationMatch) {
    const [, generationId, action] = generationMatch;
    let generation = await loadGeneration(env, generationId);
    await assertProjectAccess(env, session, generation.project_id);
    if (method === "GET" && !action) {
      // The browser may advance a multi-stage render here. MCP read-only
      // connections must only observe saved state: advancing a social render
      // can submit its next paid provider stage.
      if (!scopedAgent && ["submitted", "running", "provider_complete", "saving", "submitting"].includes(generation.status))
        generation = await advanceGeneration(env, generation);
      return json({
        generation: generationView(generation),
        budget: await budgetSnapshot(env, generation.project_id),
      });
    }
    if (method === "POST" && action === "cancel") {
      generation = await cancelGeneration(env, generation);
      return json({ generation: generationView(generation), budget: await budgetSnapshot(env, generation.project_id) });
    }
    if (method === "POST" && action === "reconcile") {
      generation = await reconcileGeneration(env, generation);
      return json({ generation: generationView(generation), budget: await budgetSnapshot(env, generation.project_id) });
    }
    if (method === "POST" && action === "save-retry") {
      if (generation.deleted_at) throw new HttpError(410, "This job has been deleted.", "unavailable");
      if (isDarkroomGeneration(generation)) {
        generation = await advanceGeneration(env, generation);
        if (generation.status !== "saved")
          throw new HttpError(409, "No result has been confirmed yet. Check this same job again.", "nothing_to_save");
        return json({ generation: generationView(generation), budget: await budgetSnapshot(env, generation.project_id) });
      }
      if (!generation.retained_key)
        throw new HttpError(409, "No retained result is waiting to be saved", "nothing_to_save");
      const object = await env.MEDIA.get(generation.retained_key);
      if (!object) throw new HttpError(410, "The retained result is no longer available", "unavailable");
      const bytes = new Uint8Array(await object.arrayBuffer());
      generation = await saveGeneration(env, generation, bytes, generation.retained_mime?.includes("mp4") ? "mp4" : "jpeg");
      return json({ generation: generationView(generation), budget: await budgetSnapshot(env, generation.project_id) });
    }
    if (method === "DELETE" && !action) {
      const alreadyDeleted = Boolean(generation.deleted_at);
      if (!alreadyDeleted) {
        generation = await env.DB.prepare(
          `UPDATE generations SET deleted_at=?2,delete_revision=delete_revision+1,updated_at=?2,error_code='erasure_pending'
           WHERE id=?1 AND deleted_at IS NULL AND status<>'saved'
             AND NOT EXISTS(SELECT 1 FROM assets WHERE generation_id=?1 AND deleted_at IS NULL) RETURNING *`,
        ).bind(generation.id, now()).first() ?? await loadGeneration(env, generation.id);
        if (!generation.deleted_at)
          throw new HttpError(409, "Saved results are removed from the library, not from their generation record", "saved_result");
      }
      if (["submitted", "running", "cancel_requested"].includes(generation.status))
        generation = await cancelGeneration(env, generation);
      await eraseDeletedGeneration(env, generation);
      return json({ deleted: true, ...(alreadyDeleted ? { alreadyDeleted: true } : {}) });
    }
  }

  throw new HttpError(404, "Not found", "not_found");
}

function defaultDefaults() {
  return {
    imageModel: "studio-print",
    videoModel: "hailuo-standard",
    audioModel: "studio-score",
    aspect: "portrait",
    durationSeconds: 6,
  };
}

function normalizeReferences(input) {
  if (!Array.isArray(input) || input.length > 12)
    throw new HttpError(400, "Keep up to 12 creative references");
  return input.map((reference) => {
    if (!reference || typeof reference !== "object" || Array.isArray(reference))
      throw new HttpError(400, "Each reference needs a title and an HTTPS link");
    const title = text(reference.title, 100, "Reference title");
    let url;
    try {
      url = new URL(String(reference.url ?? ""));
    } catch {
      throw new HttpError(400, "Each reference needs a full HTTPS link");
    }
    if (url.protocol !== "https:" || url.username || url.password)
      throw new HttpError(400, "References must be plain HTTPS links");
    return {
      id: typeof reference.id === "string" && /^[a-z0-9_-]{4,60}$/i.test(reference.id) ? reference.id : id("ref"),
      title,
      url: url.href,
      note: text(reference.note ?? "", 240, "Reference note", { required: false }),
    };
  });
}

/** Begin the supported large-file path: one signed, single-use PUT bound to
 * this project, this agent connection, the declared size and SHA-256. JSON-RPC
 * inputs and results stay bounded; only the original bytes travel over HTTP. */
async function beginAssetUpload(env, project, session, input, request) {
  if (!session.agentTokenId)
    throw new HttpError(403, "Begin an upload from an agent connection. No upload link was created.", "agent_connection_required");
  if (session.project && session.project !== project.id)
    throw new HttpError(403, "This agent connection can only upload into its granted project. No upload link was created.", "upload_project_mismatch");
  return createUploadLink(env, {
    projectId: project.id,
    tokenId: session.agentTokenId,
    filename: input.filename,
    contentType: input.contentType,
    bytes: input.bytes,
    sha256: input.sha256,
    request,
  });
}

/** Receive the bytes for one link. Every refusal happens before D1 or R2 is
 * written; the link is claimed only after the bytes, hash, sniffed type and
 * duplicate check have all passed. Admission, keys and asset columns are the
 * same `storeAsset` path a multipart upload uses. */
async function receiveAssetUpload(request, env, url, linkId) {
  const link = await loadUploadLink(env, linkId);
  if (!link) throw new HttpError(404, "This upload link is not valid. Begin a new upload.", "upload_link_unknown");
  if (link.consumed_at)
    throw new HttpError(409, "This upload link was already used. Begin a new upload.", "upload_link_used");
  if (link.expires_at <= now())
    throw new HttpError(410, "This upload link expired. Begin a new upload.", "upload_link_expired");
  const projectId = url.searchParams.get("p") ?? "";
  if (projectId !== link.project_id)
    throw new HttpError(403, "This upload link belongs to another project. Nothing was saved.", "upload_project_mismatch");
  if (!await verifyUploadLink(env, link, { expires: url.searchParams.get("e"), signature: url.searchParams.get("s") }))
    throw new HttpError(403, "This upload link is not valid. Begin a new upload.", "upload_link_invalid");

  const grant = await env.DB.prepare(
    "SELECT id,project_id,issuer_json,scopes,revoked_at,expires_at FROM mcp_tokens WHERE id=?1",
  ).bind(link.token_id).first();
  const scopes = String(grant?.scopes ?? "").split(" ");
  if (
    !grant ||
    grant.revoked_at ||
    grant.expires_at <= now() ||
    grant.project_id !== link.project_id ||
    !scopes.includes("studio.edit")
  )
    throw new HttpError(403, "The agent connection for this upload is no longer active. Begin a new upload.", "connection_revoked");
  const issuer = safeJson(grant.issuer_json, null);
  if (!issuer || (issuer.mode !== "owner" && issuer.mode !== "bridge"))
    throw new HttpError(403, "The agent connection for this upload is no longer active. Begin a new upload.", "connection_revoked");
  await verifyComposerGrant(env, issuer, "edit");

  const project = await env.DB.prepare("SELECT * FROM projects WHERE id=?1").bind(link.project_id).first();
  if (!project) throw new HttpError(404, "Project not found", "not_found");
  if (!Number.isSafeInteger(link.bytes) || link.bytes < 1 || link.bytes > MAX_VIDEO_BYTES)
    throw new HttpError(413, "This upload is larger than Studio accepts. Nothing was saved.", "too_large");

  const bytes = await readBoundedBody(request, link.bytes);
  if (bytes.length !== link.bytes)
    throw new HttpError(400, "The upload size does not match the declared byte count. Nothing was saved.", "size_mismatch");
  const hash = await sha256Hex(bytes);
  if (!constantTimeEqual(hash, link.sha256))
    throw new HttpError(422, "The uploaded bytes do not match the declared SHA-256. Nothing was saved.", "hash_mismatch");

  const sniffed = sniffMedia(bytes, link.mime);
  if (!sniffed.kind)
    throw new HttpError(415, "Upload a JPEG, PNG or WebP image, an MP4 or WebM video, or WAV, MP3 or M4A audio", "unsupported_type");
  const limit = sniffed.kind === "image" ? MAX_IMAGE_BYTES : sniffed.kind === "audio" ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES;
  if (bytes.length > limit)
    throw new HttpError(413, `${sniffed.kind === "image" ? "Images" : sniffed.kind === "audio" ? "Audio" : "Videos"} must stay under ${limit / 1024 / 1024} MiB. Nothing was saved.`, "too_large");

  const duplicate = await findDuplicateOriginal(env, project, { sha256: hash, size: bytes.length, mime: sniffed.mime });
  if (!duplicate.valid) throw new HttpError(400, duplicate.reason, "invalid_fingerprint");
  if (!await claimUploadLink(env, link)) {
    const latest = await loadUploadLink(env, link.id);
    if (latest?.consumed_at)
      throw new HttpError(409, "This upload link was already used. Begin a new upload.", "upload_link_used");
    throw new HttpError(410, "This upload link expired. Begin a new upload.", "upload_link_expired");
  }

  if (duplicate.duplicate) {
    await env.DB.prepare("UPDATE asset_upload_links SET asset_id=?2 WHERE id=?1 AND asset_id IS NULL")
      .bind(link.id, duplicate.duplicate.id)
      .run();
    return json({
      asset: assetView(duplicate.duplicate, { duplicate: true, reused: true }),
      upload: { linkId: link.id, reused: true },
    });
  }

  // A deterministic id makes two concurrent uploads of the same bytes collide
  // on the existing assets row instead of creating a second original.
  const identity = await sha256Hex(
    new TextEncoder().encode(JSON.stringify([project.id, "upload-link", hash, bytes.length, sniffed.mime])),
  );
  const title = link.filename.replace(/\.[^.]+$/, "").slice(0, 100) || "Untitled";
  const stored = await storeAsset(env, project, bytes, {
    mime: sniffed.mime,
    title,
    caption: "",
    importId: `asset_${identity}`,
    hash,
  });
  const payload = await stored.json();
  if (payload?.asset?.id)
    await env.DB.prepare("UPDATE asset_upload_links SET asset_id=?2 WHERE id=?1 AND asset_id IS NULL")
      .bind(link.id, payload.asset.id)
      .run();
  return json({ ...payload, upload: { linkId: link.id, reused: stored.status === 200 } }, stored.status);
}

async function uploadAsset(request, env, project) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("multipart/form-data"))
    throw new HttpError(415, "Upload the file as form data", "unsupported_media_type");
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file to upload");
  if (file.size === 0) throw new HttpError(400, "That file is empty");
  if (file.size > MAX_VIDEO_BYTES)
    throw new HttpError(413, `Keep uploads under ${MAX_VIDEO_BYTES / 1024 / 1024} MiB`, "too_large");

  const title = String(form.get("title") ?? "").trim() || file.name.replace(/\.[^.]+$/, "").slice(0, 100);
  const receiptId = form.get("localRenderReceiptId");
  let receipt = null;
  if (receiptId !== null) {
    if (typeof receiptId !== "string" || !/^lrr_[a-f0-9]{32}$/.test(receiptId)) throw new HttpError(400, "Invalid local render receipt");
    receipt = await env.DB.prepare("SELECT * FROM local_render_receipts WHERE id=?1 AND project_id=?2").bind(receiptId,project.id).first();
    if (!receipt) throw new HttpError(404, "Local render receipt not found", "not_found");
    const bound = await env.DB.prepare("SELECT id FROM assets WHERE id=?1 AND project_id=?2").bind(receipt.output_asset_id,project.id).first();
    if (!bound && receipt.expires_at < now()) throw new HttpError(409, "This render receipt expired. Start a new render.", "receipt_expired");
  }
  const footageId = form.get("footageExportReceiptId");
  let footageReceipt = null;
  if (footageId !== null) {
    if (receipt || typeof footageId !== "string" || !/^fer_[a-f0-9]{32}$/.test(footageId)) throw new HttpError(400, "Invalid footage receipt");
    footageReceipt = await env.DB.prepare("SELECT * FROM footage_export_receipts WHERE id=?1 AND project_id=?2").bind(footageId,project.id).first();
    if (!footageReceipt) throw new HttpError(404, "Footage receipt not found", "not_found");
  }
  return storeAsset(env, project, new Uint8Array(await file.arrayBuffer()), {
    mime: file.type, title, caption: String(form.get("caption") ?? ""),
    parent: form.get("parentAssetId") ? String(form.get("parentAssetId")) : null,
    ...(receipt ? { importId: receipt.output_asset_id, localReceipt: true, caption: "", parent: null } : {}),
    ...(footageReceipt ? { importId: footageReceipt.output_asset_id, footageReceipt, caption: "", parent: footageReceipt.source_asset_id } : {}),
  });
}

async function importWoodhouseAsset(env, project, shareId) {
  let asset;
  let bytes;
  try {
    asset = await shareAsset(shareId);
    bytes = await shareOriginal(asset, MAX_IMAGE_BYTES);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.warn("Woodhouse original request failed", error.message);
    throw new HttpError(502, "Woodhouse Share did not return this artwork. Try again later.");
  }
  if (sniffMedia(bytes).kind !== "image")
    throw new HttpError(415, "This Share original is not a supported image.");
  const hash = await sha256Hex(bytes);
  if (asset.original.sha256 && asset.original.sha256 !== hash)
    throw new HttpError(409, "The original changed in transit. Check this artwork in Woodhouse Share.");
  const identity = await sha256Hex(new TextEncoder().encode(JSON.stringify([project.id, shareId, hash])));
  const existing = await env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind("asset_" + identity).first();
  if (existing?.deleted_at) throw new HttpError(409, "This imported original was previously removed from this project.");
  if (existing) return json({ asset: assetView(existing) });
  const anchor = shareApi + "/" + shareId;
  const source = woodhouseUrl(asset.sourceUrl);
  const caption = [anchor, source, asset.credit].filter(Boolean).join("\n").slice(0, 400);
  return storeAsset(env, project, bytes, {
    title: String(asset.title ?? shareId).slice(0, 100), caption,
    importId: "asset_" + identity, hash,
  });
}

async function storeAsset(env, project, bytes, { mime, title, caption, parent = null, importId, hash, localReceipt = false, footageReceipt = null }) {
  const sniffed = sniffMedia(bytes, mime);
  if (!sniffed.kind)
    throw new HttpError(
      415,
      "Upload a JPEG, PNG or WebP image, an MP4 or WebM video, or WAV, MP3 or M4A audio",
      "unsupported_type",
    );
  const limit =
    sniffed.kind === "image" ? MAX_IMAGE_BYTES : sniffed.kind === "audio" ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES;
  if (bytes.length > limit)
    throw new HttpError(413, `${sniffed.kind === "image" ? "Images" : sniffed.kind === "audio" ? "Audio" : "Videos"} must stay under ${limit / 1024 / 1024} MiB`, "too_large");
  if ((localReceipt || footageReceipt) && sniffed.mime !== "video/mp4") throw new HttpError(415, "A local render receipt requires an MP4", "unsupported_type");

  let size;
  if (sniffed.kind === "image") {
    const image = imageSize(bytes);
    size = { width: image.width, height: image.height, durationMs: null };
    if (!image.width || !image.height)
      throw new HttpError(415, "That image could not be read. Try a standard JPEG or PNG.", "unsupported_type");
  } else if (sniffed.kind === "audio") {
    const audio = audioInfo(bytes);
    size = { width: null, height: null, durationMs: audio.durationMs, sampleRate: audio.sampleRate, channels: audio.channels };
    if (!audio.format)
      throw new HttpError(415, "That audio could not be read. Try WAV, MP3 or M4A.", "unsupported_type");
  } else {
    const video = sniffed.mime === "video/webm" ? await webmVideoSize(bytes) : videoInfo(bytes);
    size = { width: video.width, height: video.height, durationMs: video.durationMs };
  }

  if (footageReceipt) {
    const snap = safeJson(footageReceipt.snapshot_json, {});
    if (size.width !== snap.framing?.width || size.height !== snap.framing?.height || !Number.isFinite(size.durationMs) || Math.abs(size.durationMs - snap.totalMs) > 150) throw new HttpError(400, "The MP4 dimensions or duration differ from the saved export.", "invalid_output");
  }
  hash ??= await sha256Hex(bytes);
  const assetId = importId ?? id("asset");
  const storageId = importId ? id("asset") : assetId;
  const key = `projects/${project.id}/assets/${storageId}/original.${extensionFor(sniffed.mime)}`;
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: sniffed.mime },
    customMetadata: { sha256: hash, project: project.id },
  });
  const timestamp = now();

  try {
    await env.DB.prepare(
      `INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,duration_ms,sample_rate,channels,sha256,title,caption,source,parent_asset_id,created_at,updated_at)
       ${localReceipt || footageReceipt ? "SELECT" : "VALUES("}?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'upload',?15,?16,?16${localReceipt ? " WHERE EXISTS (SELECT 1 FROM local_render_receipts WHERE output_asset_id=?1 AND project_id=?2 AND expires_at>=?16)" : footageReceipt ? " WHERE EXISTS (SELECT 1 FROM footage_export_receipts r JOIN footage_plans p ON p.id=r.plan_id AND p.project_id=r.project_id AND p.revision=r.plan_revision JOIN assets source ON source.id=r.source_asset_id AND source.project_id=r.project_id AND source.sha256=r.source_sha256 AND source.deleted_at IS NULL WHERE r.output_asset_id=?1 AND r.project_id=?2 AND r.expires_at>=?16)" : ")"}${importId ? " ON CONFLICT(id) DO NOTHING" : ""}`,
    )
      .bind(
        assetId,
        project.id,
        sniffed.kind,
        key,
        sniffed.mime,
        bytes.length,
        size.width ?? null,
        size.height ?? null,
        size.durationMs ?? null,
        size.sampleRate ?? null,
        size.channels ?? null,
        hash,
        text(title, 100, "Title", { required: false }) || "Untitled",
        text(caption, 400, "Caption", { required: false }),
        parent,
        timestamp,
      )
      .run();
  } catch (error) {
    // D1 may have committed the row before its reply was lost. Preserve any
    // indexed original and let the normal readback confirm the result.
    const committed = await env.DB.prepare("SELECT id FROM assets WHERE id=?1 AND project_id=?2")
      .bind(assetId, project.id).first();
    if (!committed) {
      await env.MEDIA.delete(key);
      throw error;
    }
  }
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(assetId).first();
  if (!asset && (localReceipt || footageReceipt)) { await env.MEDIA.delete(key); throw new HttpError(409, "This render receipt expired. Start a new render.", "receipt_expired"); }
  if (asset.r2_key !== key) await env.MEDIA.delete(key);
  if ((localReceipt || footageReceipt) && asset.sha256 !== hash) throw new HttpError(409, "This receipt is already bound to different output bytes.", "receipt_already_bound");
  if (asset.deleted_at) throw new HttpError(409, "This imported original was previously removed from this project.");
  return json({ asset: assetView(asset, { hasLocalRenderReceipt: localReceipt }) }, asset.r2_key === key ? 201 : 200);
}

async function handlePublic(request, env, url) {
  const path = url.pathname;

  // Signed, single-use upload for one original. It carries no session cookie:
  // the signature, the staging row and the live agent connection are the
  // authority, and the bytes go through the same admission as a form upload.
  const uploadLink = path.match(/^\/upload\/assets\/(upl_[a-f0-9]{32})$/);
  if (uploadLink) {
    if (request.method !== "PUT")
      throw new HttpError(405, "Method not allowed", "method_not_allowed");
    return receiveAssetUpload(request, env, url, uploadLink[1]);
  }

  // Signed, short-lived input for one render job. No session, no listing, no
  // other asset: the provider can read exactly what this job needs to read.
  const renderInput = path.match(/^\/render-input\/([a-z0-9_]+)$/);
  if (renderInput) {
    if (request.method !== "GET" && request.method !== "HEAD")
      throw new HttpError(405, "Method not allowed", "method_not_allowed");
    const assetId = renderInput[1];
    const projectId = url.searchParams.get("p") ?? "";
    const valid = await verifyRenderLink(env, {
      assetId,
      projectId,
      expires: url.searchParams.get("e"),
      signature: url.searchParams.get("s"),
    });
    if (!valid) throw new HttpError(403, "This render link is not valid or has expired", "link_expired");
    const asset = await env.DB.prepare(
      "SELECT * FROM assets WHERE id=?1 AND project_id=?2 AND deleted_at IS NULL",
    )
      .bind(assetId, projectId)
      .first();
    if (!asset) throw new HttpError(404, "Not found", "not_found");
    const range = parseRange(request.headers.get("range"), asset.bytes);
    if (range?.invalid)
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${asset.bytes}`, "accept-ranges": "bytes" },
      });
    const object = await env.MEDIA.get(
      asset.r2_key,
      range ? { range: { offset: range.offset, length: range.length } } : undefined,
    );
    if (!object) throw new HttpError(410, "The stored bytes are unavailable", "unavailable");
    return new Response(request.method === "HEAD" ? null : object.body, {
      status: range ? 206 : 200,
      headers: {
        "content-type": asset.mime,
        ...rangeHeaders(range, asset.bytes),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  }

  const reviewMatch = path.match(/^\/r\/([A-Za-z0-9_-]{1,128})(\/media|\/compare)?\/?$/);
  if (reviewMatch) {
    const [, token, extra] = reviewMatch;
    const refusalTitle = (error) => {
      switch (error.code) {
        case "review_revoked":
          return "This review link was revoked";
        case "review_expired":
          return "This review link expired";
        case "review_version_changed":
          return "This review link no longer matches the saved version";
        case "review_asset_unavailable":
          return "This saved version is no longer available";
        case "review_compare_unavailable":
          return "These private review links cannot be compared";
        case "review_compare_same":
          return "Choose two different review links";
        case "review_rate_limited":
          return "Too many review attempts";
        case "unsupported_media_type":
          return "That comparison could not be read";
        default:
          return "This review link is not available";
      }
    };
    const reviewPageHeaders = {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow, noarchive",
    };
    if (extra === "/compare") {
      if (request.method !== "POST")
        return new Response(
          reviewRefusalPage({
            title: "Compare two saved versions",
            message: "Open your private review page, then choose “Compare with another version”.",
            code: "review_compare_method",
          }),
          { status: 405, headers: reviewPageHeaders },
        );
      try {
        await assertCompareAttemptAllowed(env, request);
        const compareToken = await reviewCompareFormToken(request);
        const compare = await compareReviewRoomsForReviewer(env, token, compareToken);
        return new Response(
          reviewComparePage({ left: compare.left, right: compare.right, primaryToken: token }),
          { status: 200, headers: reviewPageHeaders },
        );
      } catch (error) {
        if (error instanceof HttpError)
          return new Response(
            reviewRefusalPage({
              title: refusalTitle(error),
              message: error.message,
              code: error.code,
            }),
            { status: error.status, headers: reviewPageHeaders },
          );
        throw error;
      }
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      throw new HttpError(405, "Method not allowed", "method_not_allowed");
    await assertReviewAttemptAllowed(env, request);
    if (extra === "/media") {
      try {
        const { room, asset } = await openReviewRoom(env, token);
        const range = parseRange(request.headers.get("range"), asset.bytes);
        if (range?.invalid)
          return new Response(null, {
            status: 416,
            headers: {
              "content-range": `bytes */${asset.bytes}`,
              "accept-ranges": "bytes",
              "cache-control": "private, no-store",
              "referrer-policy": "no-referrer",
              "x-robots-tag": "noindex, nofollow, noarchive",
            },
          });
        const object = await env.MEDIA.get(
          asset.r2_key,
          range ? { range: { offset: range.offset, length: range.length } } : undefined,
        );
        if (!object)
          return new Response("This saved version is no longer available.", {
            status: 410,
            headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow, noarchive" },
          });
        return new Response(request.method === "HEAD" ? null : object.body, {
          status: range ? 206 : 200,
          headers: {
            "content-type": room.asset_mime,
            ...rangeHeaders(range, asset.bytes),
            "cache-control": "private, no-store",
            "referrer-policy": "no-referrer",
            "x-robots-tag": "noindex, nofollow, noarchive",
            "x-content-type-options": "nosniff",
            etag: `"${room.asset_sha256.slice(0, 32)}"`,
          },
        });
      } catch (error) {
        if (error instanceof HttpError) {
          if (error.status === 404 || error.status === 410) await recordReviewFailure(env, request).catch(() => {});
          return new Response(error.message, {
            status: error.status,
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "private, no-store",
              "referrer-policy": "no-referrer",
              "x-robots-tag": "noindex, nofollow, noarchive",
            },
          });
        }
        throw error;
      }
    }
    try {
      const { room } = await openReviewRoom(env, token);
      const feedback = await reviewFeedbackForRoom(env, room);
      const html = reviewRoomPage({
        room,
        feedback,
        mediaPath: `/r/${encodeURIComponent(token)}/media`,
        reviewPath: `/r/${encodeURIComponent(token)}`,
        kind: room.asset_kind,
        title: room.version_label,
        expiresAt: room.expires_at,
      });
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "private, no-store",
          "referrer-policy": "no-referrer",
          "x-robots-tag": "noindex, nofollow, noarchive",
        },
      });
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 404 || error.status === 410) await recordReviewFailure(env, request).catch(() => {});
        return new Response(
          reviewRefusalPage({
            title: refusalTitle(error),
            message: error.message,
            code: error.code,
          }),
          {
            status: error.status,
            headers: {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "private, no-store",
              "referrer-policy": "no-referrer",
              "x-robots-tag": "noindex, nofollow, noarchive",
            },
          },
        );
      }
      throw error;
    }
  }

  const publicationMatch = path.match(/^\/p\/([A-Za-z0-9_-]+)(\/poster-preview|\/poster|\/download|\/media|\/thumb)?$/);
  if (publicationMatch) {
    const [, publicSlug, extra] = publicationMatch;
    const publication = await env.DB.prepare(
      `SELECT p.*, a.kind AS asset_kind, a.mime AS asset_mime, a.width, a.height, a.duration_ms, a.bytes, a.deleted_at AS asset_deleted
       FROM publications p JOIN assets a ON a.id=p.asset_id
       WHERE p.slug=?1 AND p.revoked_at IS NULL`,
    )
      .bind(publicSlug)
      .first();
    if (!publication || publication.asset_deleted)
      throw new HttpError(404, "This page is not published", "not_found");

    if (extra === "/download") return servePublished(request, env, publication.asset_id, true);
    if (extra === "/media") return servePublished(request, env, publication.asset_id, false);
    if (extra === "/thumb") return servePublicationThumb(request, env, publication);
    if (extra === "/poster-preview") return servePosterPreview(request, env, publication);
    if (extra === "/poster") {
      if (!publication.poster_asset_id) throw new HttpError(404, "No poster for this page", "not_found");
      return servePublished(request, env, publication.poster_asset_id, false);
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      throw new HttpError(405, "Method not allowed", "method_not_allowed");

    let posterAsset = null;
    if (publication.poster_asset_id) {
      posterAsset = await env.DB.prepare(
        "SELECT id,kind,mime,width,height,sha256,deleted_at FROM assets WHERE id=?1",
      )
        .bind(publication.poster_asset_id)
        .first();
    }
    const usablePoster = posterAsset && !posterAsset.deleted_at && posterAsset.kind === "image" ? posterAsset : null;
    // The page-size derivative only stands in for first paint when it was rendered
    // from the poster the page currently names.
    const posterPreview = usablePoster
      ? await env.DB.prepare(
          "SELECT width,height,source_sha256 FROM publication_derivatives WHERE publication_id=?1 AND kind='poster'",
        )
          .bind(publication.id)
          .first()
      : null;
    const usablePosterPreview =
      posterPreview && posterPreview.source_sha256 === usablePoster.sha256 ? posterPreview : null;
    // A published film with no chosen poster still has a stored preview from the
    // gallery pipeline. Use it for the video poster and the share image so a
    // shared link keeps its thumbnail instead of falling back to text-only.
    const preview = !usablePoster && publication.asset_kind === "video"
      ? await env.DB.prepare(
          "SELECT mime,width,height FROM publication_derivatives WHERE publication_id=?1 AND kind='thumb'",
        )
          .bind(publication.id)
          .first()
      : null;
    const poster =
      publication.asset_kind === "image"
        ? `/p/${publication.slug}/download`
        : usablePoster
          ? `/p/${publication.slug}/poster`
          : preview
            ? `/p/${publication.slug}/thumb`
            : null;
    // The share image above stays the full poster. Only the first paint of the
    // film element earns a smaller still.
    const videoPoster =
      publication.asset_kind !== "video"
        ? null
        : usablePoster
          ? usablePosterPreview
            ? `/p/${publication.slug}/poster-preview`
            : `/p/${publication.slug}/poster`
          : preview
            ? `/p/${publication.slug}/thumb`
            : null;
    const destinations = sharingDestinations(env);
    // Only permit a local gallery return; never turn a public link into an open redirect.
    let galleryBack = "/gallery";
    const requestedBack = url.searchParams.get("back");
    if (requestedBack && requestedBack.length <= 2048 && requestedBack.startsWith("/gallery?")) {
      const backUrl = new URL(requestedBack, url.origin);
      if (backUrl.origin === url.origin && backUrl.pathname === "/gallery") {
        const params = new URLSearchParams();
        const query = (backUrl.searchParams.get("q") ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
        const kind = backUrl.searchParams.get("kind");
        const project = (backUrl.searchParams.get("project") ?? "").slice(0, 80);
        const capability = backUrl.searchParams.get("capability");
        const order = backUrl.searchParams.get("order");
        const page = backUrl.searchParams.get("page");
        if (query) params.set("q", query);
        if (["image", "video", "audio"].includes(kind)) params.set("kind", kind);
        if (/^[A-Za-z0-9_-]+$/.test(project)) params.set("project", project);
        if (["original", "variation", "refinement", "assembled"].includes(capability)) params.set("capability", capability);
        if (order === "oldest") params.set("order", order);
        if (page && /^[1-9][0-9]{0,4}$/.test(page)) params.set("page", page);
        if (params.size) galleryBack += `?${params}#gallery-results`;
      }
    }
    // Bounded, same-project public continuations. Uses the gallery's own public
    // read boundary and card renderer; nothing is listed, published or changed.
    const listed = Boolean(publication.listed) && !publication.hidden;
    const related = listed
      ? await relatedWorks(env, publication.project_id, publication.id)
      : [];
    const html = publicPage({
      galleryBack,
      related,
      title: publication.title,
      description: publication.description,
      listed,
      // First playable publication instant, not the asset's own created_at.
      publishedAt: publication.created_at,
      attribution: safeJson(publication.attribution_json, []),
      kind: publication.asset_kind,
      mime: publication.asset_mime,
      width: publication.width,
      height: publication.height,
      durationMs: publication.duration_ms,
      bytes: publication.bytes,
      media: `/p/${publication.slug}/media`,
      download: `/p/${publication.slug}/download`,
      poster,
      videoPoster,
      posterMime: usablePoster?.mime ?? preview?.mime ?? null,
      posterWidth: usablePoster?.width ?? preview?.width ?? null,
      posterHeight: usablePoster?.height ?? preview?.height ?? null,
      buildUrl: destinations.buildUrl,
      storyUrl: destinations.storyUrl,
      origin: env.PUBLIC_ORIGIN || url.origin,
      slug: publication.slug,
    });
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" },
    });
  }

  const shareMatch = path.match(/^\/s\/([A-Za-z0-9_-]+)$/);
  if (shareMatch) {
    const publication = await env.DB.prepare(
      "SELECT asset_id FROM publications WHERE slug=?1 AND revoked_at IS NULL",
    )
      .bind(shareMatch[1])
      .first();
    if (!publication) throw new HttpError(404, "Not found", "not_found");
    return servePublished(request, env, publication.asset_id, false);
  }

  if (path === "/healthz") {
    return json({
      ok: true,
      revision: BUILD.revision,
      bridge: Boolean(env.BRIDGE_SECRET),
      builtAt: BUILD.builtAt,
      time: new Date().toISOString(),
    });
  }
  if (path === "/build.json") return json({ revision: BUILD.revision, builtAt: BUILD.builtAt });
  if (path === "/capabilities.json") {
    const manifest = await readCapabilityManifest(env);
    return json(manifest, 200, { "cache-control": "public, max-age=300, s-maxage=3600" });
  }

  if (path === "/bridge") {
    const token = url.searchParams.get("token");
    const claim = await readBridgeToken(env, token);
    if (!claim)
      return new Response(loginPage({ next: "/", revision: BUILD.revision, bridged: Boolean(env.BRIDGE_SECRET), composerOrigin: env.COMPOSER_ORIGIN, storyUrl: env.PUBLIC_STORY_URL, woodhouseShare: env.WOODHOUSE_SHARE === "true" }), {
        status: 401,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    if (!(await claimHandoff(env, claim)))
      return new Response(loginPage({ next: "/", revision: BUILD.revision, bridged: Boolean(env.BRIDGE_SECRET), composerOrigin: env.COMPOSER_ORIGIN, storyUrl: env.PUBLIC_STORY_URL, woodhouseShare: env.WOODHOUSE_SHARE === "true" }), {
        status: 409,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    const session = await createSession(env, {
      mode: "bridge",
      actor: claim.actor,
      actorName: claim.actorName,
      workspace: claim.workspace,
      workspaceName: claim.workspaceName,
      project: claim.project,
      projectClaimExplicit: true,
      actions: claim.actions,
      revision: claim.revision,
    });
    return new Response(null, {
      status: 302,
      headers: {
        location: "/",
        "set-cookie": sessionCookie(session, "bridge"),
        "cache-control": "no-store",
      },
    });
  }

  if (path === "/login") return handleLogin(request, env);
  if (path === "/share-films.json" && env.WOODHOUSE_SHARE === "true") {
    if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "Method not allowed", "method_not_allowed");
    const films = await shareShowcaseFilms(env);
    return json({ version: 1, films }, 200, { "cache-control": "no-store" });
  }
  if (path.replace(/\/+$/, "") === "/portfolio" && env.WOODHOUSE_SHARE === "true") {
    if (request.method !== "GET" && request.method !== "HEAD")
      throw new HttpError(405, "Method not allowed", "method_not_allowed");
    const assetId = url.searchParams.get("asset");
    const validId = /^[a-z0-9][a-z0-9-]{0,127}$/;
    if (assetId && !validId.test(assetId)) throw new HttpError(400, "Enter a valid Share asset ID.");
    const target = new URL(assetId ? `${composerShare}/artwork/${assetId}` : composerShare);
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    if (query) target.searchParams.set("art", query);
    for (const name of ["project", "after"]) {
      const value = url.searchParams.get(name);
      if (value && validId.test(value)) target.searchParams.set(name, value);
    }
    return Response.redirect(target, 308);
  }
  if (path === "/tools/add-music") {
    return new Response(addMusicPage({ revision: BUILD.revision }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
  }
  if (path === "/tools/video-clip") {
    return new Response(videoClipPage({ revision: BUILD.revision }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
  }
  if (path === "/tools/audio-trim") {
    return new Response(audioTrimPage({ revision: BUILD.revision }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
  }
  if (path === "/tools/images") {
    return new Response(imagesPage({ revision: BUILD.revision }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
  }
  // Public discovery files are rebuilt from D1 and enumerate only the public
  // state. They share the 60-second public cache boundary with the pages they
  // name, so a withdrawal disappears within that window. Above the single-file
  // cap, /sitemap.xml is a same-origin index of numbered child sitemaps.
  const sitemapChild = path.match(/^\/sitemap-([1-9][0-9]*)\.xml$/);
  if (path === "/sitemap.xml" || sitemapChild || path === "/robots.txt") {
    const origin = publicOrigin(env, request.url);
    if (path === "/robots.txt") {
      return new Response(robotsTxt(origin), {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": `public, max-age=${PUBLIC_CACHE_SECONDS}`,
        },
      });
    }
    const body = await publicSitemap(env, origin, sitemapChild ? Number(sitemapChild[1]) : null);
    if (body === null) {
      return new Response(notFoundPage(), {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return new Response(body, {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": `public, max-age=${PUBLIC_CACHE_SECONDS}`,
      },
    });
  }
  if (path === "/gallery") {
    const rawPage = url.searchParams.get("page") ?? "1";
    const page = /^[1-9][0-9]{0,4}$/.test(rawPage) ? Number(rawPage) : 1;
    const query = (url.searchParams.get("q") ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
    const requestedKind = url.searchParams.get("kind") ?? "";
    const kind = ["image", "video", "audio"].includes(requestedKind) ? requestedKind : "";
    const requestedProject = (url.searchParams.get("project") ?? "").slice(0, 80);
    const project = /^[A-Za-z0-9_-]+$/.test(requestedProject) ? requestedProject : "";
    const requestedCapability = url.searchParams.get("capability") ?? "";
    const capability = ["original", "variation", "refinement", "assembled"].includes(requestedCapability) ? requestedCapability : "";
    const order = url.searchParams.get("order") === "oldest" ? "oldest" : "newest";
    const showFeatured = page === 1 && order === "newest" && !query && !kind && !project && !capability;
    const [catalogue, featured] = await Promise.all([
      publicCatalogue(env, page, 24, { query, kind, order, project, capability }),
      showFeatured ? homeShowcase(env, { listedOnly: true }) : [],
    ]);
    return new Response(publicGallery({ ...catalogue, featured, page, query, kind, order, woodhouseShare: env.WOODHOUSE_SHARE === "true" }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": `public, max-age=${PUBLIC_CACHE_SECONDS}` } });
  }
  if (path === "/help") {
    return new Response(helpPage({ composerOrigin: env.COMPOSER_ORIGIN, storyUrl: env.PUBLIC_STORY_URL }), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" },
    });
  }
  if (path === "/compare") {
    const session = await readSession(env, request);
    if (!session) {
      return new Response(
        loginPage({
          next: "/compare",
          revision: BUILD.revision,
          bridged: Boolean(env.BRIDGE_SECRET),
          composerOrigin: env.COMPOSER_ORIGIN,
          storyUrl: env.PUBLIC_STORY_URL,
          woodhouseShare: env.WOODHOUSE_SHARE === "true",
        }),
        { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
      );
    }
    // A project-scoped link keeps the comparison on the studio the owner was
    // working in. Without it, a bridged session has no project claim and would
    // show an empty page even though the project holds saved takes.
    const requestedProject = url.searchParams.get("project");
    let project = null;
    if (requestedProject) {
      const candidate = await loadProject(env, requestedProject, { required: false });
      if (candidate && projectAccessible(session, candidate)) project = candidate;
    } else {
      project = await currentProject(env, session);
    }
    if (!project) {
      const { results: candidates } = await env.DB.prepare(
        "SELECT id,name,workspace_id,updated_at FROM projects ORDER BY updated_at DESC LIMIT 60",
      ).all();
      const projects = candidates
        .filter((candidate) => projectAccessible(session, candidate))
        .map((candidate) => ({ id: candidate.id, name: candidate.name, updatedAt: candidate.updated_at }));
      return new Response(
        comparePage({
          revision: BUILD.revision,
          jobs: [],
          job: null,
          entries: [],
          project: null,
          projects,
          verdict: {
            headline: "No project yet",
            detail: "A comparison belongs to a project. Open one in the studio, keep a take, then use Compare models from that project.",
          },
          session,
          composerOrigin: env.COMPOSER_ORIGIN,
          storyUrl: env.PUBLIC_STORY_URL,
          woodhouseShare: env.WOODHOUSE_SHARE === "true",
          models,
        }),
        { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
      );
    }
    const jobs = jobCatalogue(models);
    // One read of the project's saved takes answers every job. The page used to
    // land on the first comparable job even when this project had no takes for
    // it, which read as "nothing to compare" while another job held real
    // evidence. The landing job is now the first one that can show a take.
    const saved = await env.DB.prepare(
      `SELECT g.id, g.model, g.kind, g.request_json, g.cost_estimate_micro, g.cost_allocated_micro, g.provider_charged_micro,
              g.created_at, g.completed_at, a.id AS asset_id, a.mime, a.bytes, a.width, a.height, a.duration_ms, a.sha256
       FROM generations g JOIN assets a ON a.id = g.output_asset_id
       WHERE g.project_id = ?1 AND g.status = 'saved' AND g.deleted_at IS NULL AND a.deleted_at IS NULL
       ORDER BY COALESCE(g.completed_at, g.created_at) DESC LIMIT 240`,
    )
      .bind(project.id)
      .all();
    const byJob = new Map();
    for (const entry of jobs) {
      const allowed = new Set(entry.models.map((model) => model.id));
      const rows = saved.results.filter((row) => allowed.has(row.model));
      const all = latestPerModel(rows, entry.id).map((take) => ({
        ...take,
        previewUrl: take.assetId ? `/api/assets/${encodeURIComponent(take.assetId)}/file` : null,
      }));
      byJob.set(entry.id, likeForLike(all));
    }
    const requested = url.searchParams.get("job") ?? "";
    const job =
      jobs.find((entry) => entry.id === requested) ??
      jobs.find((entry) => (byJob.get(entry.id)?.chosen.length ?? 0) > 1) ??
      jobs.find((entry) => (byJob.get(entry.id)?.chosen.length ?? 0) > 0) ??
      jobs.find((entry) => entry.comparable) ??
      jobs[0] ??
      null;
    const split = job ? byJob.get(job.id) : null;
    const entries = split?.chosen ?? [];
    const excluded = split?.excluded ?? [];
    const briefNote = split?.reason ?? null;
    const review = { job, entries };
    return new Response(
      comparePage({
        revision: BUILD.revision,
        jobs,
        job,
        project,
        entries,
        verdict: compareVerdict({ ...review, models }),
        weakness: compareWeakness(review),
        excluded,
        briefNote,
        session,
        composerOrigin: env.COMPOSER_ORIGIN,
        storyUrl: env.PUBLIC_STORY_URL,
        woodhouseShare: env.WOODHOUSE_SHARE === "true",
        models,
      }),
      { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
    );
  }
  if (path === "/" || path === "/studio") {
    const session = await readSession(env, request);
    if (!session) {
      if (path === "/studio") return new Response(loginPage({ next: "/", revision: BUILD.revision, bridged: Boolean(env.BRIDGE_SECRET), composerOrigin: env.COMPOSER_ORIGIN, storyUrl: env.PUBLIC_STORY_URL, woodhouseShare: env.WOODHOUSE_SHARE === "true" }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      const catalogue = await publicCatalogue(env, 1, 6, { withFacets: false });
      const featured = catalogue.items.length ? [] : await homeShowcase(env);
      return new Response(publicGallery({ ...catalogue, ...sharingDestinations(env), featured, page: 1, home: true, woodhouseShare: env.WOODHOUSE_SHARE === "true" }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": `public, max-age=${PUBLIC_CACHE_SECONDS}` } });
    }
    return new Response(shell({
      revision: BUILD.revision,
      session,
      composerOrigin: env.COMPOSER_ORIGIN,
      storyUrl: env.PUBLIC_STORY_URL,
      woodhouseShare: env.WOODHOUSE_SHARE === "true",
    }), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" },
    });
  }

  if (env.ASSETS) return env.ASSETS.fetch(request);
  return new Response(notFoundPage(), {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function servePublished(request, env, assetId, download) {
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(assetId).first();
  if (!asset || asset.deleted_at) throw new HttpError(404, "Not found", "not_found");
  const inspected = await checkPublicImage(env, asset).catch((error) => {
    if (error.code !== "publication_metadata_unverified") throw error;
    throw new HttpError(404, "This media is not available for public sharing", "not_found");
  });
  const range = parseRange(request.headers.get("range"), asset.bytes);
  if (range?.invalid)
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${asset.bytes}`, "accept-ranges": "bytes" },
    });
  const etag = `"${asset.sha256.slice(0, 32)}"`;
  // The tag comes from the stored bytes and the caller already resolved a live
  // publication, so an unchanged copy can be reused without sending it again.
  // The short max-age stays: a withdrawn page stops resolving at the next check.
  if (!range && matchesEtag(request.headers.get("if-none-match"), etag))
    return new Response(null, {
      status: 304,
      headers: { etag, "cache-control": "public, max-age=60" },
    });
  let body = inspected;
  if (inspected) {
    if (range) body = inspected.subarray(range.start, range.end + 1);
  } else {
    const object = await env.MEDIA.get(
      asset.r2_key,
      range ? { range: { offset: range.offset, length: range.length } } : undefined,
    );
    if (!object) throw new HttpError(410, "This media is no longer available", "unavailable");
    body = object.body;
  }
  const headers = {
    "content-type": asset.mime,
    ...rangeHeaders(range, asset.bytes),
    // A withdrawn publication must stop resolving quickly, so public media is
    // only briefly cacheable rather than cached for a day.
    "cache-control": "public, max-age=60",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "cross-origin",
    etag,
  };
  if (download)
    headers["content-disposition"] = `attachment; filename="published-${asset.id}.${extensionFor(asset.mime)}"`;
  return new Response(request.method === "HEAD" ? null : body, {
    status: range ? 206 : 200,
    headers,
  });
}

async function servePublicationThumb(request, env, publication) {
  if (request.method !== "GET" && request.method !== "HEAD")
    throw new HttpError(405, "Method not allowed", "method_not_allowed");
  const derivative = await env.DB.prepare(
    "SELECT r2_key,mime,bytes,sha256 FROM publication_derivatives WHERE publication_id=?1 AND kind='thumb'",
  )
    .bind(publication.id)
    .first();
  if (!derivative) throw new HttpError(404, "No fast preview for this page", "not_found");
  const etag = `"${derivative.sha256.slice(0, 32)}"`;
  if (matchesEtag(request.headers.get("if-none-match"), etag))
    return new Response(null, {
      status: 304,
      headers: { etag, "cache-control": "public, max-age=60" },
    });
  const object = await env.MEDIA.get(derivative.r2_key);
  if (!object) throw new HttpError(404, "No fast preview for this page", "not_found");
  return new Response(request.method === "HEAD" ? null : object.body, {
    headers: {
      "content-type": derivative.mime,
      "content-length": String(derivative.bytes),
      etag,
      // A withdrawal must stop resolving quickly, so never cache for long.
      "cache-control": "public, max-age=60",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}

async function servePosterPreview(request, env, publication) {
  if (request.method !== "GET" && request.method !== "HEAD")
    throw new HttpError(405, "Method not allowed", "method_not_allowed");
  // The chosen poster must still be a live image and the derivative must have
  // been rendered from exactly those bytes. There is deliberately no fallback to
  // the full poster on this path: it exists only to make first paint small.
  const derivative = await env.DB.prepare(
    `SELECT d.r2_key,d.mime,d.bytes,d.sha256
     FROM publication_derivatives d
     JOIN publications p ON p.id=d.publication_id
     JOIN assets poster ON poster.id=p.poster_asset_id AND poster.project_id=p.project_id
       AND poster.kind='image' AND poster.deleted_at IS NULL
     WHERE d.publication_id=?1 AND d.kind='poster' AND d.source_sha256=poster.sha256`,
  )
    .bind(publication.id)
    .first();
  if (!derivative) throw new HttpError(404, "No poster preview for this page", "not_found");
  const etag = `"${derivative.sha256.slice(0, 32)}"`;
  if (matchesEtag(request.headers.get("if-none-match"), etag))
    return new Response(null, {
      status: 304,
      headers: { etag, "cache-control": "public, max-age=60" },
    });
  const object = await env.MEDIA.get(derivative.r2_key);
  if (!object) throw new HttpError(404, "No poster preview for this page", "not_found");
  return new Response(request.method === "HEAD" ? null : object.body, {
    headers: {
      "content-type": derivative.mime,
      "content-length": String(derivative.bytes),
      etag,
      // A withdrawal must stop resolving quickly, so never cache for long.
      "cache-control": "public, max-age=60",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}

/**
 * Fill missing or stale posters and asset previews a bounded page at a time.
 * Each row is independent, so one refusal never blocks the rest, and a repeated
 * call skips rows whose source hash already matches.
 *
 * There is deliberately no scheduled caller. Building a rendition needs the
 * Cloudflare Images binding, and on this installation's account the binding
 * answers 9432 (legacy billing), so a cron pass could never converge and would
 * log a refusal every minute. The owner-session route stays, and the browser
 * backfill in `public/studio.js` builds poster previews with canvas instead.
 */
async function backfillPreviews(env, session, kind, limit) {
  let processed = 0;
  let failed = 0;
  if (kind === "posters") {
    const rows = await env.DB.prepare(
      `SELECT p.id,p.project_id,p.slug,pr.workspace_id AS project_workspace_id,
              poster.id AS poster_id,poster.r2_key,poster.kind,poster.mime,poster.width,poster.height,
              poster.sha256,poster.deleted_at
       FROM publications p
       JOIN assets poster ON poster.id=p.poster_asset_id AND poster.project_id=p.project_id
         AND poster.kind='image' AND poster.deleted_at IS NULL
       JOIN projects pr ON pr.id=p.project_id
       LEFT JOIN publication_derivatives d ON d.publication_id=p.id AND d.kind='poster'
       WHERE p.revoked_at IS NULL
         AND (d.publication_id IS NULL OR d.source_sha256 IS NULL OR d.source_sha256<>poster.sha256)
       ORDER BY p.created_at ASC,p.id ASC LIMIT ?1`,
    )
      .bind(limit)
      .all();
    for (const row of rows.results) {
      if (!projectAccessible(session, { id: row.project_id, workspace_id: row.project_workspace_id })) continue;
      try {
        await storePosterDerivative(
          env,
          { id: row.id, project_id: row.project_id, slug: row.slug },
          {
            id: row.poster_id,
            kind: row.kind,
            r2_key: row.r2_key,
            mime: row.mime,
            width: row.width,
            height: row.height,
            sha256: row.sha256,
            deleted_at: row.deleted_at,
          },
        );
        processed += 1;
      } catch (error) {
        failed += 1;
        console.warn("Could not backfill a poster preview", row.id, error?.code ?? error?.message);
      }
    }
  } else {
    const rows = await env.DB.prepare(
      `SELECT a.id,a.project_id,a.kind,a.r2_key,a.width,a.height,a.sha256,a.deleted_at,
              pr.workspace_id AS project_workspace_id
       FROM assets a
       JOIN projects pr ON pr.id=a.project_id
       LEFT JOIN asset_previews v ON v.asset_id=a.id
       WHERE a.deleted_at IS NULL AND a.kind='image'
         AND (v.asset_id IS NULL OR v.source_sha256<>a.sha256)
       ORDER BY a.created_at ASC,a.id ASC LIMIT ?1`,
    )
      .bind(limit)
      .all();
    for (const row of rows.results) {
      if (!projectAccessible(session, { id: row.project_id, workspace_id: row.project_workspace_id })) continue;
      try {
        await storeAssetPreview(env, row);
        processed += 1;
      } catch (error) {
        failed += 1;
        console.warn("Could not backfill an asset preview", row.id, error?.code ?? error?.message);
      }
    }
  }
  const remaining = kind === "posters"
    ? (await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM publications p
         JOIN assets poster ON poster.id=p.poster_asset_id AND poster.project_id=p.project_id
           AND poster.kind='image' AND poster.deleted_at IS NULL
         LEFT JOIN publication_derivatives d ON d.publication_id=p.id AND d.kind='poster'
         WHERE p.revoked_at IS NULL
           AND (d.publication_id IS NULL OR d.source_sha256 IS NULL OR d.source_sha256<>poster.sha256)`,
      ).first()).n
    : (await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM assets a
         LEFT JOIN asset_previews v ON v.asset_id=a.id
         WHERE a.deleted_at IS NULL AND a.kind='image'
           AND (v.asset_id IS NULL OR v.source_sha256<>a.sha256)`,
      ).first()).n;
  return { kind, processed, remaining: Number(remaining) || 0, failed };
}

// Keep the same dispatch promise alive if the browser leaves while awaiting the
// provider. This is a bounded extension, not a guarantee or a retry: a lost
// reply still becomes unknown and retains its reservation.
function retainDispatch(ctx, promise) {
  if (ctx) ctx.waitUntil(promise);
  return promise;
}

// Darkroom runs each generation in its own Durable Object; wrangler.jsonc binds it as MEDIA_OPERATION.
export { MediaOperationDO } from "@fungi.computer/darkroom/cloudflare";

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/') || url.pathname.startsWith('/.well-known/oauth-')) {
        const origin = env.PUBLIC_ORIGIN || url.origin;
        const protect = (response) => {
          const secured = securityHeaders(response);
          const headers = new Headers(secured.headers);
          const callbackOrigin = headers.get('x-studio-internal-callback-origin');
          headers.delete('x-studio-internal-callback-origin');
          headers.set('cache-control', 'no-store');
          // Chrome sends Origin: null on a form POST from a no-referrer page.
          // same-origin still suppresses referrers to the loopback client.
          const formPage = request.method === 'GET' && (url.pathname === '/mcp/authorize' || url.pathname === '/mcp/connections');
          headers.set('referrer-policy', formPage ? 'same-origin' : 'no-referrer');
          if (formPage && url.pathname === '/mcp/authorize' && callbackOrigin) {
            // OAuth validated the registered loopback URI before providing this
            // internal header. Chrome checks form-action on the 303 as well.
            headers.set('content-security-policy', headers.get('content-security-policy').replace("form-action 'self'", `form-action 'self' ${callbackOrigin}`));
          }
          return new Response(secured.body, { status: secured.status, headers });
        };
        if (url.origin !== origin || (request.headers.get('origin') && request.headers.get('origin') !== origin))
          return protect(json({ error: 'Origin is not allowed' }, 403));
        if (url.pathname === '/mcp') {
          const session = await authorizeMcp(request, env);
          if (!session) return protect(json({ error: 'Authentication required. This agent connection is no longer active or has expired; reconnect from Studio Agent connections and grant access again. Nothing was changed.' }, 401, { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="studio.read"` }));
          const quoteGeneration = async ({ projectId, body, maxCostMicro }) => {
            const current = await authorizeMcp(request, env);
            const refuse = (message) => { const error = new Error(message); error.publicMessage = message; throw error; };
            if (!current || !can(current, 'generate') || current.project !== projectId) refuse('This connection cannot generate in that project.');
            const project = await loadProject(env, projectId);
            const model = getModel(body.model);
            if (model.kind !== body.kind || model.render) refuse('Choose a supported generation model for this media type.');
            if ((model.provider === PROVIDER_FAL && !env.FAL_KEY) || (model.provider === PROVIDER_CLOUDFLARE && !env.AI)) refuse('The required provider is not configured; nothing was submitted.');
            const settings = validateSettings(model, body);
            const costMicro = estimateCost(model, settings);
            if (costMicro > maxCostMicro) refuse('The current estimate exceeds the requested maximum; nothing was submitted.');
            if ((await budgetSnapshot(env, projectId)).availableMicro < costMicro) refuse('The project allowance is insufficient; nothing was submitted.');
            return { costMicro, modelLabel: model.label, projectName: project.name };
          };
          const handler = createStudioMcpHandler(async ({ method, path, body, binaryRange, spend }) => {
            const current = await authorizeMcp(request, env);
            if (!current) return { status: 403, body: { error: { code: 'forbidden', message: 'The agent connection is no longer active. Reconnect from Studio Agent connections and grant access again; a revoked connection cannot be reused.' } } };
            const generationPath = /^\/api\/projects\/([a-z0-9_]+)\/generations$/.exec(path);
            if (generationPath && method === 'POST') {
              if (!spend || !Number.isSafeInteger(spend.quotedCostMicro)) return { status: 403, body: { error: { code: 'spend_authority_required', message: 'This request has no approved spending authority.' } } };
              const quote = await quoteGeneration({ projectId: generationPath[1], body, maxCostMicro: spend.maxCostMicro });
              if (quote.costMicro !== spend.quotedCostMicro) return { status: 409, body: { error: { code: 'estimate_changed', message: 'The estimate changed. Request a new confirmation.' } } };
              const fingerprint = await sha256Hex(new TextEncoder().encode(JSON.stringify({ projectId: generationPath[1], body })));
              if (!await reserveMcpSpend(env, current.agentTokenId, body.clientRequestId, fingerprint, quote.costMicro)) return { status: 403, body: { error: { code: 'connection_spend_exhausted', message: 'The connection spending limit is exhausted or this request ID was already used for different work.' } } };
              if (!await authorizeMcp(request, env)) return { status: 403, body: { error: { code: 'forbidden', message: 'The agent connection is no longer active during this request. Nothing was submitted. Reconnect from Studio Agent connections and grant access again.' } } };
              // The existing job table scopes idempotency to the whole project.
              // Namespace MCP IDs by token to prevent a client from causing an
              // unrelated admitted job to dispatch under its own cheaper quote.
              const internalRequestId = await sha256Hex(new TextEncoder().encode(JSON.stringify([current.agentTokenId, body.clientRequestId])));
              body = { ...body, clientRequestId: `mcp_${internalRequestId}` };
            }
            const headers = new Headers();
            if (body !== undefined) headers.set('content-type', 'application/json');
            if (binaryRange) headers.set('range', `bytes=${binaryRange.offset}-${binaryRange.offset + binaryRange.length - 1}`);
            const internal = new Request(origin + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            try {
              const response = await handleApi(internal, env, new URL(internal.url), ctx, current);
              if (binaryRange && response.status === 206) {
                const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
                const bytes = new Uint8Array(await response.arrayBuffer());
                if (!range || bytes.length > 49152) throw new Error('Invalid media range');
                const nextOffset = Number(range[2]) + 1, totalBytes = Number(range[3]);
                return { status: 206, body: { encoding: 'base64', mime: response.headers.get('content-type'), offset: Number(range[1]), nextOffset: nextOffset < totalBytes ? nextOffset : null, totalBytes, data: btoa(String.fromCharCode(...bytes)) } };
              }
              if (binaryRange && response.status === 416) return { status: 416, body: { error: { code: 'invalid_range', message: 'The offset is outside the asset.' } } };
              return { status: response.status, body: await response.json() };
            } catch (error) {
              if (error instanceof HttpError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
              throw error;
            }
          }, {
            stateKey: env.SESSION_SECRET,
            binding: await sha256Hex(new TextEncoder().encode(request.headers.get('authorization') || '')),
            quote: quoteGeneration,
          });
          return protect(await handler.fetch(request));
        }
        const response = await oauthRoute(request, env, url);
        if (response) return protect(response);
        return protect(json({ error: 'Not found' }, 404));
      }
      const response = url.pathname.startsWith("/api/")
        ? await handleApi(request, env, url, ctx)
        : await handlePublic(request, env, url);
      const reviewPath = /^\/r\/[A-Za-z0-9_-]{1,128}(?:\/(?:media|compare))?\/?$/.test(url.pathname) || url.pathname.startsWith("/api/review/");
      const pagePath = url.pathname.replace(/\/+$/, "") || "/";
      const studioShell = (pagePath === "/" || pagePath === "/studio") &&
        response.headers.get("cache-control") === "private, no-store";
      const shareImages = env.WOODHOUSE_SHARE === "true" && studioShell;
      return securityHeaders(response, shareImages, { noReferrer: reviewPath });
    } catch (error) {
      if (error instanceof PortableError)
        return securityHeaders(json({ error: { code: error.code, message: error.message }, report: error.report }, error.status));
      if (error instanceof HttpError) {
        if (error.status === 401 && !new URL(request.url).pathname.startsWith("/p/"))
          return securityHeaders(json({ error: { code: error.code, message: error.message }, signedIn: false }, 401));
        return securityHeaders(problem(error.message, error.status, error.code));
      }
      console.error("media-studio", error);
      return securityHeaders(problem("Something went wrong. Nothing was charged by this request.", 500, "internal"));
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const pending = await pendingGenerations(env, 8);
        for (const generation of pending) {
          try { await advanceGeneration(env, generation); }
          catch { if (!generation.deleted_at) console.error("Could not advance Studio job", generation.id); }
        }
      })(),
    );
    ctx.waitUntil((async () => {
      const { results } = await env.DB.prepare("SELECT * FROM assets WHERE erasure_pending=1 ORDER BY updated_at LIMIT 8").all();
      for (const asset of results) {
        try { await eraseAsset(env, asset); }
        catch { /* The tombstone stays pending for the next sweep. */ }
      }
    })());
    ctx.waitUntil((async () => {
      await env.DB.prepare("DELETE FROM grant_checks WHERE expires_at < ?1")
        .bind(now() - 60 * 60 * 1000)
        .run();
    })().catch(() => {}));
    ctx.waitUntil(pruneMcpRecords(env));
    // A consumed or expired upload handoff has no further use. Keep one day for
    // the owner-visible receipt, then remove the staging row.
    ctx.waitUntil(
      env.DB.prepare("DELETE FROM asset_upload_links WHERE expires_at<?1")
        .bind(now() - 24 * 60 * 60 * 1000)
        .run()
        .catch(() => {}),
    );
    ctx.waitUntil(pruneReviewAttempts(env).catch(() => {}));
    // Read-only capability freshness: real work at most once a day. The every-
    // minute trigger already exists; a failed check keeps the last good copy.
    ctx.waitUntil(refreshCapabilities(env).catch((error) => console.error("Capability refresh unavailable", error?.message ?? error)));
  },
};
