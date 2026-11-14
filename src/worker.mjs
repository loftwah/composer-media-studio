// MIT. Media Studio Worker: owner studio, public pages and the job engine.

import {
  allowedActions,
  can,
  checkLoginRate,
  claimHandoff,
  clearCookie,
  createSession,
  readBridgeToken,
  readSession,
  recordLoginFailure,
  requireSession,
  sessionCookie,
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
  updateComposition,
  dispatchRender,
  loadGeneration,
  loadProject,
  pendingGenerations,
  reconcileGeneration,
  saveGeneration,
} from "./lib/jobs.mjs";
import { createFootagePlan, listFootagePlans, updateFootagePlan } from "./lib/footage-plans.mjs";
import { createSongPlan, listSongPlans, updateSongPlan, updateSongCaptions, exportSongCaptions } from "./lib/song-plans.mjs";
import { createLocalRenderReceipt } from "./lib/local-render-receipts.mjs";
import { listSubjects, subjectVersions, saveSubject } from "./lib/subjects.mjs";
import { publicModels, getModel, validateSettings, estimateCost, PROVIDER_FAL, PROVIDER_CLOUDFLARE } from "./lib/providers.mjs";
import { handleFalWebhook } from "./lib/fal-webhook.mjs";
import { builtinRecipe, projectRecipes, renderPrompt, builtinRecipes } from "./lib/recipes.mjs";
import { reuseStillFor, sharingDestinations } from "./lib/sharing.mjs";
import { shareAsset, shareOriginal, sharePage, woodhouseUrl, shareApi, shareOrigin } from "./lib/woodhouse-share.mjs";
import { shell, loginPage, publicPage, notFoundPage, helpPage, woodhouseGallery, audioTrimPage, videoClipPage, addMusicPage, publicGallery } from "./lib/ui.mjs";
import { verifyRenderLink } from "./lib/render-links.mjs";
import { inventory, policyFor, publishCandidate, setPolicy } from "./lib/publication-policy.mjs";
import { createStudioMcpHandler } from "./mcp/tools.mjs";
import { authorizeMcp, oauthRoute, pruneMcpRecords, reserveMcpSpend } from "./mcp/oauth.mjs";
import {
  audioInfo,
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

function securityHeaders(response, woodhouse = false) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
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

function rangeHeaders(range, size) {
  return {
    "accept-ranges": "bytes",
    "content-length": String(range ? range.length : size),
    ...(range ? { "content-range": `bytes ${range.start}-${range.end}/${size}` } : {}),
  };
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

function generationView(generation, extra = {}) {
  const request = safeJson(generation.request_json, {});
  return {
    id: generation.id,
    kind: generation.kind,
    status: generation.status,
    model: generation.model,
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
    costObservedMicro: generation.cost_observed_micro,
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

// Only explicitly configured, still-published films are safe for the home gallery.
async function homeShowcase(env) {
  const slugs = String(env.PUBLIC_SHOWCASE_SLUGS ?? "").split(",").map((value) => value.trim()).filter((value) => /^[A-Za-z0-9_-]{1,80}$/.test(value)).slice(0, 8);
  const rows = await Promise.all(slugs.map((value) => env.DB.prepare(`SELECT p.slug,p.title,p.description,poster.id AS poster_asset_id,a.mime
    FROM publications p JOIN assets a ON a.id=p.asset_id
    LEFT JOIN assets poster ON poster.id=p.poster_asset_id AND poster.project_id=p.project_id AND poster.kind='image' AND poster.deleted_at IS NULL
    WHERE p.slug=?1 AND p.revoked_at IS NULL AND p.hidden=0 AND a.deleted_at IS NULL AND a.kind='video'`).bind(value).first()));
  return rows.filter(Boolean).slice(0, 3).map((row) => ({ slug: row.slug, title: row.title, description: row.description, mime: row.mime, hasPoster: Boolean(row.poster_asset_id) }));
}

async function publicCatalogue(env, page = 1, limit = 24) {
  const result = await env.DB.prepare(`SELECT p.slug,p.title,p.description,p.created_at,a.kind,a.mime,
    poster.id AS poster_asset_id FROM publications p JOIN assets a ON a.id=p.asset_id AND a.project_id=p.project_id
    LEFT JOIN assets poster ON poster.id=p.poster_asset_id AND poster.project_id=p.project_id AND poster.kind='image' AND poster.deleted_at IS NULL
    WHERE p.listed=1 AND p.hidden=0 AND p.revoked_at IS NULL AND a.deleted_at IS NULL
    ORDER BY p.created_at DESC,p.id DESC LIMIT ?1 OFFSET ?2`).bind(limit + 1, (page - 1) * limit).all();
  return { items: result.results.slice(0, limit), hasMore: result.results.length > limit };
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

  if (path === "/api/session") {
    const session = await readSession(env, request);
    return json({
      signedIn: Boolean(session),
      mode: session?.mode ?? null,
      actor: session?.actorName ?? session?.actor ?? null,
      workspace: session?.workspaceName ?? session?.workspace ?? null,
      project: session?.project ?? null,
      actions: allowedActions(session),
      composerOrigin: typeof env.COMPOSER_ORIGIN === "string" ? env.COMPOSER_ORIGIN : null,
      storyUrl: typeof env.PUBLIC_STORY_URL === "string" ? env.PUBLIC_STORY_URL : null,
    });
  }

  // Every private route declares the action it needs. A project-scoped bridge
  // session cannot read or change another project, even with a valid cookie.
  const projectIdFromPath = (path.match(/^\/api\/projects\/([a-z0-9_]+)/) ?? [])[1] ?? null;
  let action = method === "GET" || method === "HEAD" ? "read" : "edit";
  if (path === "/api/state" || path === "/api/models") action = "read";
  if (path === "/api/projects" && method === "POST") action = "edit";
  if (/\/generations$/.test(path) && method === "POST") action = "generate";
  if (/\/render$/.test(path) && method === "POST") action = "generate";
  if (/\/publish$/.test(path) && method === "POST") action = "publish";
  if (/^\/api\/publications\//.test(path)) action = "publish";
  if (/^\/api\/projects\/[a-z0-9_]+\/publication-(policy|inventory|reconcile)$/.test(path)) action = "publish";
  if (/^\/api\/generations\/[a-z0-9_]+$/.test(path) && method === "DELETE") action = "edit";
  if (/^\/api\/generations\/[a-z0-9_]+\/(cancel|reconcile|save-retry)$/.test(path)) action = "generate";
  if (/\/export$/.test(path)) action = "read";

  const session = scopedAgent ?? await requireSession(env, request, action);
  if (scopedAgent && !can(session, action))
    throw new HttpError(403, "This agent connection does not permit this action.", "forbidden");
  if (session.mode !== "owner" && session.project && projectIdFromPath && session.project !== projectIdFromPath)
    throw new HttpError(
      403,
      "This studio session is scoped to another project. Reopen the project from App Composer.",
      "forbidden",
    );

  if (method !== "GET" && method !== "HEAD") assertSameOrigin(request, env);

  const publicationPolicyMatch = path.match(/^\/api\/projects\/([a-z0-9_]+)\/publication-(policy|inventory|reconcile)$/);
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
    if (operation === "reconcile" && method === "POST") {
      const input = await body(request);
      if (input.confirm !== true || input.rightsConfirmed !== true || !Array.isArray(input.assetIds) || input.assetIds.length > 100 || input.assetIds.length < 1 || input.assetIds.some((item) => typeof item !== "string" || !/^asset_[a-z0-9_]+$/.test(item))) throw new HttpError(400, "Confirm rights and provide 1–100 asset IDs.");
      const policy = await policyFor(env, projectId);
      if (!policy.installationAllowed || !policy.enabled) throw new HttpError(403, "Enable the first-party publication policy for this project first.", "not_allowed");
      const results = [];
      for (const assetId of [...new Set(input.assetIds)]) results.push({ assetId, result: await publishCandidate(env, projectId, assetId) });
      return json({ results });
    }
    throw new HttpError(405, "Method not allowed", "method_not_allowed");
  }

  if (path === "/api/models" && method === "GET")
    return json({ models: publicModels(), videosConfigured: Boolean(env.FAL_KEY) });

  if (path === "/api/state" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all();
    const visible = session.mode !== "owner" && session.project
      ? results.filter((project) => project.id === session.project)
      : results;
    return json({
      projects: await Promise.all(visible.map((project) => projectSummary(env, project))),
      showcase: await homeShowcase(env),
      models: publicModels(),
      videosConfigured: Boolean(env.FAL_KEY),
      allowanceDefaultMicro: Number(env.MONTHLY_ALLOWANCE_MICRO) || 5_000_000,
      recipes: builtinRecipes,
      destinations: sharingDestinations(env),
      woodhouseShare: env.WOODHOUSE_SHARE === "true",
    });
  }

  if (path === "/api/projects" && method === "POST") {
    const input = await body(request);
    const name = text(input.name, 80, "Studio name");
    const creativeDirection = text(input.creativeDirection ?? "", 600, "Creative direction", { required: false });
    const visibility = input.visibility === "unlisted" ? "unlisted" : "private";
    const projectId = id("prj");
    const timestamp = now();
    await env.DB.prepare(
      "INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
    )
      .bind(projectId, name, slug(8), creativeDirection, visibility, JSON.stringify(defaultDefaults()), timestamp, timestamp)
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
      const generations = await env.DB.prepare("SELECT * FROM generations WHERE project_id=?1 ORDER BY created_at DESC LIMIT 40")
        .bind(project.id)
        .all();
      const recipes = await env.DB.prepare("SELECT * FROM recipes WHERE project_id=?1 ORDER BY created_at ASC")
        .bind(project.id)
        .all();
      const publications = await env.DB.prepare("SELECT * FROM publications WHERE project_id=?1 AND revoked_at IS NULL ORDER BY created_at DESC")
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
          assetView(asset, { reuseStillId: reuseById.get(asset.id)?.id ?? null, hasLocalRenderReceipt: receiptAssetIds.has(asset.id) }),
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

    if (rest === "assets/woodhouse" && method === "POST" && env.WOODHOUSE_SHARE === "true") {
      const input = await body(request);
      if (input.reuseConfirmed !== true)
        throw new HttpError(400, "Confirm permission to reuse this original.");
      return importWoodhouseAsset(env, project, input.assetId);
    }

    if (rest === "assets" && method === "POST")
      return uploadAsset(request, env, project);

    if (rest === "subjects" && method === "GET") return json({ subjects: await listSubjects(env, project) });
    if (rest === "subjects" && method === "POST") return json({ subject: await saveSubject(env, project, await body(request)) }, 201);
    const subjectMatch = rest && rest.match(/^subjects\/([a-z0-9_]+)$/);
    if (subjectMatch && method === "GET") return json({ versions: await subjectVersions(env, project, subjectMatch[1]) });
    if (subjectMatch && method === "PATCH") return json({ subject: await saveSubject(env, project, await body(request), subjectMatch[1]) });

    if (rest === "footage-plans" && method === "GET") return json({ plans: await listFootagePlans(env, project) });
    if (rest === "footage-plans" && method === "POST") return json({ plan: await createFootagePlan(env, project, await body(request)) }, 201);
    const footagePlanEdit = rest && rest.match(/^footage-plans\/([a-z0-9_]+)$/);
    if (footagePlanEdit && method === "PATCH") return json({ plan: await updateFootagePlan(env, project, footagePlanEdit[1], await body(request)) });

    if (rest === "song-plans" && method === "GET") return json({ plans: await listSongPlans(env, project) });
    if (rest === "song-plans" && method === "POST") return json({ plan: await createSongPlan(env, project, await body(request)) }, 201);
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
        notes: [
          "Secrets, provider keys and session cookies are never included.",
          "Cost figures reflect Studio estimates and reservations, not verified provider invoice charges; the legacy costObservedMicro field is an allocated estimate.",
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

  const assetMatch = path.match(/^\/api\/assets\/([a-z0-9_]+)(?:\/(file|download|publish|local-render-receipt))?$/);
  if (assetMatch) {
    const [, assetId, action] = assetMatch;
    const asset = await env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(assetId).first();
    if (!asset) throw new HttpError(404, "Asset not found", "not_found");
    if (session.mode !== "owner" && session.project && asset.project_id !== session.project)
      throw new HttpError(403, "This studio session is scoped to another project.", "forbidden");

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
      if (asset.deleted_at) return json({ deleted: true, alreadyDeleted: true });
      await env.DB.prepare(
        "UPDATE assets SET deleted_at=?2,delete_revision=delete_revision+1,updated_at=?2 WHERE id=?1",
      )
        .bind(asset.id, now())
        .run();
      await env.DB.prepare("UPDATE publications SET revoked_at=?2 WHERE asset_id=?1 AND revoked_at IS NULL")
        .bind(asset.id, now())
        .run();
      await env.DB.prepare("UPDATE publications SET revoked_at=?2 WHERE poster_asset_id=?1 AND revoked_at IS NULL")
        .bind(asset.id, now())
        .run();
      await env.MEDIA.delete(asset.r2_key);
      return json({ deleted: true });
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
      const title = text(input.title ?? asset.title, 100, "Public title");
      const description = text(input.description ?? "", 300, "Public description", { required: false });
      let posterAssetId = null;
      if (asset.kind === "video" && input.posterAssetId) {
        const poster = await env.DB.prepare(
          "SELECT id FROM assets WHERE id=?1 AND project_id=?2 AND kind='image' AND deleted_at IS NULL",
        )
          .bind(String(input.posterAssetId), asset.project_id)
          .first();
        posterAssetId = poster?.id ?? null;
      }
      const publicationId = id("pub");
      const publicSlug = slug(12);
      await env.DB.prepare(
        "INSERT INTO publications(id,project_id,asset_id,poster_asset_id,slug,title,description,asset_revision,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
      )
        .bind(publicationId, asset.project_id, asset.id, posterAssetId, publicSlug, title, description, asset.delete_revision, now())
        .run();
      return json({ publication: { id: publicationId, path: `/p/${publicSlug}`, title, description } }, 201);
    }
  }

  const publicationMatch = path.match(/^\/api\/publications\/([a-z0-9_]+)$/);
  if (publicationMatch && method === "PATCH") {
    const input = await body(request);
    if (typeof input.listed !== "boolean" && typeof input.hidden !== "boolean") throw new HttpError(400, "Send listed or hidden as a boolean", "invalid");
    const row = await env.DB.prepare("SELECT id,project_id FROM publications WHERE id=?1 AND revoked_at IS NULL").bind(publicationMatch[1]).first();
    if (!row) throw new HttpError(404, "Publication not found", "not_found");
    if (session.mode !== "owner" && session.project && row.project_id !== session.project)
      throw new HttpError(403, "This studio session is scoped to another project.", "forbidden");
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
    if (session.mode !== "owner" && session.project && row.project_id !== session.project)
      throw new HttpError(403, "This studio session is scoped to another project.", "forbidden");
    await env.DB.prepare("UPDATE publications SET revoked_at=?2 WHERE id=?1 AND revoked_at IS NULL")
      .bind(row.id, now())
      .run();
    return json({ revoked: true });
  }

  const generationMatch = path.match(/^\/api\/generations\/([a-z0-9_]+)(?:\/(cancel|reconcile|save-retry))?$/);
  if (generationMatch) {
    const [, generationId, action] = generationMatch;
    let generation = await loadGeneration(env, generationId);
    if (session.mode !== "owner" && session.project && generation.project_id !== session.project)
      throw new HttpError(403, "This studio session is scoped to another project.", "forbidden");
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
      if (!generation.retained_key)
        throw new HttpError(409, "No retained result is waiting to be saved", "nothing_to_save");
      const object = await env.MEDIA.get(generation.retained_key);
      if (!object) throw new HttpError(410, "The retained result is no longer available", "unavailable");
      const bytes = new Uint8Array(await object.arrayBuffer());
      generation = await saveGeneration(env, generation, bytes, generation.retained_mime?.includes("mp4") ? "mp4" : "jpeg");
      return json({ generation: generationView(generation), budget: await budgetSnapshot(env, generation.project_id) });
    }
    if (method === "DELETE" && !action) {
      if (generation.status === "saved")
        throw new HttpError(409, "Saved results are removed from the library, not from their generation record", "saved_result");
      if (generation.deleted_at) return json({ deleted: true, alreadyDeleted: true });
      await env.DB.prepare(
        "UPDATE generations SET deleted_at=?2,delete_revision=delete_revision+1,updated_at=?2 WHERE id=?1",
      )
        .bind(generation.id, now())
        .run();
      if (generation.retained_key) await env.MEDIA.delete(generation.retained_key);
      if (["submitted", "running", "cancel_requested"].includes(generation.status))
        await cancelGeneration(env, generation);
      return json({ deleted: true });
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
  return storeAsset(env, project, new Uint8Array(await file.arrayBuffer()), {
    mime: file.type, title, caption: String(form.get("caption") ?? ""),
    parent: form.get("parentAssetId") ? String(form.get("parentAssetId")) : null,
    ...(receipt ? { importId: receipt.output_asset_id, localReceipt: true, caption: "", parent: null } : {}),
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

async function storeAsset(env, project, bytes, { mime, title, caption, parent = null, importId, hash, localReceipt = false }) {
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
  if (localReceipt && sniffed.mime !== "video/mp4") throw new HttpError(415, "A local render receipt requires an MP4", "unsupported_type");

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
    const video = videoInfo(bytes);
    size = { width: video.width, height: video.height, durationMs: video.durationMs };
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
       ${localReceipt ? "SELECT" : "VALUES("}?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'upload',?15,?16,?16${localReceipt ? " WHERE EXISTS (SELECT 1 FROM local_render_receipts WHERE output_asset_id=?1 AND project_id=?2 AND expires_at>=?16)" : ")"}${importId ? " ON CONFLICT(id) DO NOTHING" : ""}`,
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
    await env.MEDIA.delete(key);
    throw error;
  }
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(assetId).first();
  if (!asset && localReceipt) { await env.MEDIA.delete(key); throw new HttpError(409, "This render receipt expired. Start a new render.", "receipt_expired"); }
  if (asset.r2_key !== key) await env.MEDIA.delete(key);
  if (localReceipt && asset.sha256 !== hash) throw new HttpError(409, "This receipt is already bound to different output bytes.", "receipt_already_bound");
  if (asset.deleted_at) throw new HttpError(409, "This imported original was previously removed from this project.");
  return json({ asset: assetView(asset, { hasLocalRenderReceipt: localReceipt }) }, asset.r2_key === key ? 201 : 200);
}

async function handlePublic(request, env, url) {
  const path = url.pathname;

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

  const publicationMatch = path.match(/^\/p\/([A-Za-z0-9_-]+)(\/poster|\/download|\/media)?$/);
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
    if (extra === "/poster") {
      if (!publication.poster_asset_id) throw new HttpError(404, "No poster for this page", "not_found");
      return servePublished(request, env, publication.poster_asset_id, false);
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      throw new HttpError(405, "Method not allowed", "method_not_allowed");

    let posterAsset = null;
    if (publication.poster_asset_id) {
      posterAsset = await env.DB.prepare(
        "SELECT id,kind,mime,width,height,deleted_at FROM assets WHERE id=?1",
      )
        .bind(publication.poster_asset_id)
        .first();
    }
    const usablePoster = posterAsset && !posterAsset.deleted_at && posterAsset.kind === "image" ? posterAsset : null;
    const poster =
      publication.asset_kind === "image"
        ? `/p/${publication.slug}/download`
        : usablePoster
          ? `/p/${publication.slug}/poster`
          : null;
    const destinations = sharingDestinations(env);
    const html = publicPage({
      title: publication.title,
      description: publication.description,
      listed: Boolean(publication.listed) && !publication.hidden,
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
      posterMime: usablePoster?.mime ?? null,
      posterWidth: usablePoster?.width ?? null,
      posterHeight: usablePoster?.height ?? null,
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
  if (path.replace(/\/+$/, "") === "/portfolio" && env.WOODHOUSE_SHARE === "true") {
    let view;
    let status = 200;
    try {
      const assetId = url.searchParams.get("asset");
      view = assetId ? { asset: await shareAsset(assetId), query: url.searchParams.get("q") ?? "", project: url.searchParams.get("project") ?? "", after: url.searchParams.get("after") ?? "" } : await sharePage(url.searchParams);
      if (!assetId && !url.searchParams.get("q") && !url.searchParams.get("project") && !url.searchParams.get("after")) {
        const slugs = String(env.PUBLIC_SHOWCASE_SLUGS ?? "").split(",").map((value) => value.trim()).filter((value) => /^[A-Za-z0-9_-]{1,80}$/.test(value)).slice(0, 24);
        const films = await Promise.all(slugs.map((value) => env.DB.prepare(`SELECT p.slug,p.title,p.description,poster.id AS poster_asset_id,a.mime,a.width,a.height,a.duration_ms
          FROM publications p JOIN assets a ON a.id=p.asset_id
          LEFT JOIN assets poster ON poster.id=p.poster_asset_id AND poster.project_id=p.project_id AND poster.kind='image' AND poster.deleted_at IS NULL
          WHERE p.slug=?1 AND p.revoked_at IS NULL AND a.deleted_at IS NULL AND a.kind='video'`).bind(value).first()));
        view.films = films.filter(Boolean);
      }
    } catch (error) {
      status = error instanceof HttpError ? error.status : 503;
      if (status === 503) console.warn("Woodhouse catalogue request failed", error.message);
      view = { error: error instanceof HttpError ? error.message : "Woodhouse Share is unavailable. Try again in a moment." };
    }
    return new Response(woodhouseGallery(view), {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": status === 200 && !view.films?.length ? "public, max-age=60" : "no-store" },
    });
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
  if (path === "/gallery") {
    const rawPage = url.searchParams.get("page") ?? "1";
    const page = /^[1-9][0-9]{0,4}$/.test(rawPage) ? Number(rawPage) : 1;
    const catalogue = await publicCatalogue(env, page);
    return new Response(publicGallery({ ...catalogue, page, woodhouseShare: env.WOODHOUSE_SHARE === "true" }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  if (path === "/help") {
    return new Response(helpPage({ composerOrigin: env.COMPOSER_ORIGIN, storyUrl: env.PUBLIC_STORY_URL }), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" },
    });
  }
  if (path === "/" || path === "/studio") {
    const session = await readSession(env, request);
    if (!session) {
      if (path === "/studio") return new Response(loginPage({ next: "/", revision: BUILD.revision, bridged: Boolean(env.BRIDGE_SECRET), composerOrigin: env.COMPOSER_ORIGIN, storyUrl: env.PUBLIC_STORY_URL, woodhouseShare: env.WOODHOUSE_SHARE === "true" }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      const catalogue = await publicCatalogue(env, 1, 6);
      const featured = catalogue.items.length ? [] : await homeShowcase(env);
      return new Response(publicGallery({ ...catalogue, featured, page: 1, home: true, woodhouseShare: env.WOODHOUSE_SHARE === "true" }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    return new Response(shell({
      revision: BUILD.revision,
      session,
      composerOrigin: env.COMPOSER_ORIGIN,
      storyUrl: env.PUBLIC_STORY_URL,
      woodhouseShare: env.WOODHOUSE_SHARE === "true",
    }), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
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
  if (!object) throw new HttpError(410, "This media is no longer available", "unavailable");
  const headers = {
    "content-type": asset.mime,
    ...rangeHeaders(range, asset.bytes),
    // A withdrawn publication must stop resolving quickly, so public media is
    // only briefly cacheable rather than cached for a day.
    "cache-control": "public, max-age=60",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "cross-origin",
    etag: `"${asset.sha256.slice(0, 32)}"`,
  };
  if (download)
    headers["content-disposition"] = `attachment; filename="published-${asset.id}.${extensionFor(asset.mime)}"`;
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: range ? 206 : 200,
    headers,
  });
}

// Keep the same dispatch promise alive if the browser leaves while awaiting the
// provider. This is a bounded extension, not a guarantee or a retry: a lost
// reply still becomes unknown and retains its reservation.
function retainDispatch(ctx, promise) {
  if (ctx) ctx.waitUntil(promise);
  return promise;
}

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
          if (!session) return protect(json({ error: 'Authentication required' }, 401, { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="studio.read"` }));
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
            if (!current) return { status: 403, body: { error: { code: 'forbidden', message: 'The agent connection is no longer active.' } } };
            const generationPath = /^\/api\/projects\/([a-z0-9_]+)\/generations$/.exec(path);
            if (generationPath && method === 'POST') {
              if (!spend || !Number.isSafeInteger(spend.quotedCostMicro)) return { status: 403, body: { error: { code: 'spend_authority_required', message: 'This request has no approved spending authority.' } } };
              const quote = await quoteGeneration({ projectId: generationPath[1], body, maxCostMicro: spend.maxCostMicro });
              if (quote.costMicro !== spend.quotedCostMicro) return { status: 409, body: { error: { code: 'estimate_changed', message: 'The estimate changed. Request a new confirmation.' } } };
              const fingerprint = await sha256Hex(new TextEncoder().encode(JSON.stringify({ projectId: generationPath[1], body })));
              if (!await reserveMcpSpend(env, current.agentTokenId, body.clientRequestId, fingerprint, quote.costMicro)) return { status: 403, body: { error: { code: 'connection_spend_exhausted', message: 'The connection spending limit is exhausted or this request ID was already used for different work.' } } };
              if (!await authorizeMcp(request, env)) return { status: 403, body: { error: { code: 'forbidden', message: 'The agent connection is no longer active.' } } };
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
      return securityHeaders(response, url.pathname.replace(/\/+$/, "") === "/portfolio" && env.WOODHOUSE_SHARE === "true");
    } catch (error) {
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
        for (const generation of pending) await advanceGeneration(env, generation);
      })(),
    );
    ctx.waitUntil(pruneMcpRecords(env));
  },
};
