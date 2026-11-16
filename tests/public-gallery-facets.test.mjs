// MIT. Public gallery facets, honest totals, cache boundary and hero previews.
import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { PUBLIC_CACHE_SECONDS } from "../src/lib/sitemap.mjs";
import { PNG_1x1, setup } from "./harness.mjs";

const base = "https://studio.test";

function get(env, path, headers = {}) {
  return worker.fetch(new Request(base + path, { headers }), env);
}

async function addProject(env, { id, name, slug }) {
  await env.DB.prepare(
    "INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES(?1,?2,?3,'','private','{}',1,1)",
  )
    .bind(id, name, slug)
    .run();
  return env.DB.prepare("SELECT * FROM projects WHERE id=?1").bind(id).first();
}

async function addPlainAsset(env, project, { id, kind = "image", source = "upload", title = id }) {
  await env.DB.prepare(
    `INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,sha256,title,caption,source,created_at,updated_at)
     VALUES(?1,?2,?3,?4,?5,10,?6,?7,?8,?9,'',?10,1,1)`,
  )
    .bind(
      id,
      project.id,
      kind,
      `key-${id}`,
      kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/png",
      kind === "audio" ? null : 1280,
      kind === "audio" ? null : 720,
      `sha-${id}`,
      title,
      source,
    )
    .run();
  return env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(id).first();
}

/**
 * One fixture work. A generation can be omitted (upload), be unreadable, or be
 * soft-deleted to prove the capability is absent rather than guessed.
 */
async function addWork(
  env,
  project,
  {
    id,
    slug,
    kind = "image",
    title = slug,
    description = "",
    createdAt = 1,
    source = "generated",
    parentAssetId = null,
    model = "studio-print",
    request = {},
    compositionId = null,
    generation = true,
    invalidRequest = false,
    generationDeleted = null,
    listed = 1,
    hidden = 0,
    revoked = null,
    posterAssetId = null,
  },
) {
  const assetId = `asset_${id}`;
  const generationId = generation ? `gen_${id}` : null;
  if (generation) {
    await env.DB.prepare(
      `INSERT INTO generations(id,project_id,composition_id,client_request_id,kind,recipe_id,provider,model,request_json,status,cost_estimate_micro,cost_reserved_micro,created_at,updated_at,deleted_at)
       VALUES(?1,?2,?3,?4,?5,'freeform','cloudflare',?6,?7,'saved',1,1,1,1,?8)`,
    )
      .bind(generationId, project.id, compositionId, `client-${id}`, kind, model, invalidRequest ? "not json" : JSON.stringify(request), generationDeleted)
      .run();
  }
  await env.DB.prepare(
    `INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,duration_ms,sha256,title,caption,source,parent_asset_id,generation_id,created_at,updated_at)
     VALUES(?1,?2,?3,?4,?5,10,?6,?7,?8,?9,?10,'',?11,?12,?13,1,1)`,
  )
    .bind(
      assetId,
      project.id,
      kind,
      `key-${id}`,
      kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/png",
      kind === "audio" ? null : 1280,
      kind === "audio" ? null : 720,
      kind === "audio" ? 2000 : null,
      `sha-${id}`,
      title,
      source,
      parentAssetId,
      generationId,
    )
    .run();
  if (generation) {
    await env.DB.prepare("UPDATE generations SET output_asset_id=?2 WHERE id=?1").bind(generationId, assetId).run();
  }
  await env.DB.prepare(
    `INSERT INTO publications(id,project_id,asset_id,poster_asset_id,slug,title,description,asset_revision,created_at,listed,hidden,revoked_at)
     VALUES(?1,?2,?3,?4,?5,?6,?7,1,?8,?9,?10,?11)`,
  )
    .bind(`pub_${id}`, project.id, assetId, posterAssetId, slug, title, description, createdAt, listed, hidden, revoked)
    .run();
  return { assetId, publicationId: `pub_${id}` };
}

function cards(html) {
  return [...html.matchAll(/<li><a class="gallery-card" href="([^"]+)"/g)].map((match) => match[1]);
}

function slugs(html) {
  return cards(html).map((href) => decodeURIComponent(href.replace(/^\/p\//, "").split("?")[0]));
}

function optionValues(html, name) {
  const select = html.match(new RegExp(`<select name="${name}">([\\s\\S]*?)</select>`))?.[1] ?? "";
  return [...select.matchAll(/<option value="([^"]*)"/g)].map((match) => match[1]);
}

async function facetFixture() {
  const { env } = await setup();
  const alpha = await addProject(env, { id: "prj_alpha", name: "Alpha Studio", slug: "alpha-studio" });
  const beta = await addProject(env, { id: "prj_beta", name: "Beta Films", slug: "beta-films" });
  const quiet = await addProject(env, { id: "prj_quiet", name: "Quiet Project", slug: "quiet-project" });
  await addProject(env, { id: "prj_empty", name: "Empty Project", slug: "empty-project" });
  const reference = await addPlainAsset(env, alpha, { id: "asset_reference" });

  await addWork(env, alpha, { id: "alpha_original", slug: "alpha-original", title: "Alpha original still", createdAt: 11 });
  await addWork(env, alpha, {
    id: "alpha_variation",
    slug: "alpha-variation",
    kind: "video",
    title: "Alpha variation film",
    createdAt: 12,
    request: { referenceAssetId: reference.id },
  });
  await addWork(env, alpha, {
    id: "alpha_refinement",
    slug: "alpha-refinement",
    title: "Alpha refinement",
    createdAt: 13,
    source: "variant",
    parentAssetId: reference.id,
    model: "studio-fill",
    request: { maskAssetId: reference.id },
  });
  await addWork(env, alpha, {
    id: "alpha_assembled",
    slug: "alpha-assembled",
    kind: "video",
    title: "Alpha assembled cut",
    createdAt: 14,
    source: "assembled",
    compositionId: "composition_alpha",
    request: { shots: [{ assetId: reference.id }] },
  });
  await addWork(env, alpha, {
    id: "alpha_upload",
    slug: "alpha-upload",
    title: "Alpha upload",
    createdAt: 15,
    source: "upload",
    generation: false,
  });
  await addWork(env, alpha, {
    id: "alpha_unreadable",
    slug: "alpha-unreadable",
    title: "Alpha unreadable generation",
    createdAt: 16,
    invalidRequest: true,
  });
  await addWork(env, beta, {
    id: "beta_sound",
    slug: "beta-sound",
    kind: "audio",
    title: "Beta sound",
    createdAt: 21,
  });

  await addWork(env, quiet, {
    id: "quiet_unlisted",
    slug: "quiet-unlisted",
    title: "Quiet unlisted",
    createdAt: 31,
    listed: 0,
  });
  await addWork(env, quiet, {
    id: "quiet_hidden",
    slug: "quiet-hidden",
    title: "Quiet hidden",
    createdAt: 32,
    hidden: 1,
  });
  await addWork(env, quiet, {
    id: "quiet_withdrawn",
    slug: "quiet-withdrawn",
    title: "Quiet withdrawn",
    createdAt: 33,
    revoked: 34,
  });
  await addPlainAsset(env, quiet, { id: "asset_quiet_private", source: "generated" });
  return { env, alpha, beta, quiet };
}

test("gallery facets expose only listed projects and capabilities, and every filter combines", async () => {
  const { env } = await facetFixture();

  const all = await get(env, "/gallery");
  assert.equal(all.status, 200);
  const allHtml = await all.text();
  assert.deepEqual(slugs(allHtml).sort(), [
    "alpha-assembled",
    "alpha-original",
    "alpha-refinement",
    "alpha-unreadable",
    "alpha-upload",
    "alpha-variation",
    "beta-sound",
  ]);
  assert.equal(cards(allHtml).length, 7);
  assert.match(allHtml, /data-total="7">7 works</);
  assert.deepEqual(optionValues(allHtml, "project"), ["", "alpha-studio", "beta-films"]);
  assert.deepEqual(optionValues(allHtml, "capability"), ["", "original", "variation", "refinement", "assembled"]);
  assert.match(allHtml, /<option value="alpha-studio"[^>]*>Alpha Studio<\/option>/);
  assert.doesNotMatch(allHtml, /prj_alpha|prj_beta|prj_quiet|prj_empty/);
  assert.doesNotMatch(allHtml, /Quiet Project|Empty Project/);

  const byProject = await (await get(env, "/gallery?project=beta-films")).text();
  assert.deepEqual(slugs(byProject), ["beta-sound"]);
  assert.match(byProject, /data-total="1">1 work</);
  assert.match(byProject, /<option value="beta-films" selected>Beta Films<\/option>/);

  const byKind = await (await get(env, "/gallery?kind=video")).text();
  assert.deepEqual(slugs(byKind).sort(), ["alpha-assembled", "alpha-variation"]);
  assert.match(byKind, /data-total="2">2 works</);

  const byCapability = await (await get(env, "/gallery?capability=original")).text();
  assert.deepEqual(slugs(byCapability).sort(), ["alpha-original", "beta-sound"]);
  assert.match(byCapability, /data-total="2">2 works</);

  const combined = await (await get(env, "/gallery?project=alpha-studio&kind=video&capability=assembled")).text();
  assert.deepEqual(slugs(combined), ["alpha-assembled"]);
  assert.match(combined, /data-total="1">1 work</);

  const noMatch = await (await get(env, "/gallery?project=alpha-studio&kind=image&capability=assembled")).text();
  assert.deepEqual(slugs(noMatch), []);
  assert.match(noMatch, /data-total="0">0 works</);
  assert.match(noMatch, /No published work matches these filters\./);
});

test("unknown facet values fall back to the unfiltered gallery instead of failing", async () => {
  const { env } = await facetFixture();
  const response = await get(env, "/gallery?project=no-such-project&kind=gif&capability=base&order=sideways&page=0");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.equal(cards(html).length, 7);
  assert.match(html, /data-total="7">7 works</);
  assert.match(html, /<option value="newest" selected>Newest first<\/option>/);
  assert.match(html, /<option value="" selected>All projects<\/option>/);
  assert.match(html, /<option value="" selected>All creations<\/option>/);
  // A valid-looking project with no listed work is ignored the same way.
  const quiet = await (await get(env, "/gallery?project=quiet-project")).text();
  assert.equal(cards(quiet).length, 7);
});

test("unlisted, hidden, withdrawn and private work never enters a public page, facet or total", async () => {
  const { env } = await facetFixture();
  for (const path of ["/gallery", "/gallery?project=quiet-project", "/gallery?capability=original", "/"]) {
    const response = await get(env, path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), `public, max-age=${PUBLIC_CACHE_SECONDS}`);
    const html = await response.text();
    assert.doesNotMatch(html, /quiet-unlisted|quiet-hidden|quiet-withdrawn|asset_quiet_private/);
    assert.doesNotMatch(html, /Quiet Project/);
  }
  const gallery = await (await get(env, "/gallery")).text();
  assert.match(gallery, /data-total="7">7 works</);
  assert.deepEqual(optionValues(gallery, "project"), ["", "alpha-studio", "beta-films"]);
});

test("the total counts every matching work while pagination links keep every filter", async () => {
  const { env } = await setup();
  const project = await addProject(env, { id: "prj_bulk", name: "Bulk Studio", slug: "bulk-studio" });
  for (let index = 0; index < 25; index += 1) {
    await addWork(env, project, {
      id: `bulk_${String(index).padStart(2, "0")}`,
      slug: `bulk-still-${index}`,
      title: `Bulk still ${index}`,
      createdAt: 100 + index,
    });
  }
  const first = await (await get(env, "/gallery?project=bulk-studio&kind=image&capability=original&q=bulk&order=oldest")).text();
  assert.equal(cards(first).length, 24);
  assert.match(first, /data-total="25">25 works</);
  const nextHref = first.match(/<a class="button secondary" href="([^"]+)">Next →<\/a>/)?.[1];
  assert.ok(nextHref, "expected a next page link");
  const next = new URL(nextHref.replaceAll("&amp;", "&"), base);
  assert.equal(next.pathname, "/gallery");
  assert.equal(next.searchParams.get("project"), "bulk-studio");
  assert.equal(next.searchParams.get("kind"), "image");
  assert.equal(next.searchParams.get("capability"), "original");
  assert.equal(next.searchParams.get("q"), "bulk");
  assert.equal(next.searchParams.get("order"), "oldest");
  assert.equal(next.searchParams.get("page"), "2");

  const second = await (await get(env, `${next.pathname}${next.search}`)).text();
  assert.equal(cards(second).length, 1);
  assert.match(second, /data-total="25">25 works</);
  const previousHref = second.match(/<a class="button secondary" href="([^"]+)">← Previous<\/a>/)?.[1];
  assert.ok(previousHref, "expected a previous page link");
  const previous = new URL(previousHref.replaceAll("&amp;", "&"), base);
  assert.equal(previous.searchParams.get("project"), "bulk-studio");
  assert.equal(previous.searchParams.get("kind"), "image");
  assert.equal(previous.searchParams.get("capability"), "original");
  assert.equal(previous.searchParams.get("q"), "bulk");
  assert.equal(previous.searchParams.get("order"), "oldest");
  assert.equal(previous.searchParams.get("page"), "1");
  assert.doesNotMatch(second, />Next →</);
});

test("gallery and filtered card links carry the browsing context back to the work page", async () => {
  const { env } = await facetFixture();
  const html = await (await get(env, "/gallery?project=alpha-studio&capability=assembled")).text();
  const href = cards(html)[0];
  assert.match(href, /^\/p\/alpha-assembled\?back=/);
  const back = new URL(href, base).searchParams.get("back");
  assert.equal(back, "/gallery?project=alpha-studio&capability=assembled&page=1");
  const detail = await (await get(env, href)).text();
  assert.match(detail, /Back to gallery/);
  assert.match(detail, /href="https:\/\/studio\.test\/gallery\?project=alpha-studio&amp;capability=assembled&amp;page=1"/);
});

test("public pages share the documented cache window while owner pages stay uncached", async () => {
  const { env } = await facetFixture();
  const publicWindow = `public, max-age=${PUBLIC_CACHE_SECONDS}`;
  assert.equal((await get(env, "/gallery")).headers.get("cache-control"), publicWindow);
  assert.equal((await get(env, "/gallery?project=alpha-studio")).headers.get("cache-control"), publicWindow);
  assert.equal((await get(env, "/")).headers.get("cache-control"), publicWindow);

  const cookie = "studio_session=" + (await createSession(env));
  const ownerHome = await get(env, "/", { cookie });
  assert.equal(ownerHome.status, 200);
  assert.equal(ownerHome.headers.get("cache-control"), "private, no-store");
  assert.equal((await get(env, "/", { cookie })).headers.get("cache-control"), "private, no-store");
  const studio = await get(env, "/studio", { cookie });
  assert.equal(studio.status, 200);
  assert.equal(studio.headers.get("cache-control"), "private, no-store");
  const imports = await get(env, "/api/studio/imports", { cookie });
  assert.equal(imports.status, 200);
  assert.equal(imports.headers.get("cache-control"), "no-store");
});

test("the home hero uses a stored page-size preview before a full poster", async () => {
  const { env } = await setup();
  const project = await addProject(env, { id: "prj_hero", name: "Hero Studio", slug: "hero-studio" });
  const poster = await addPlainAsset(env, project, { id: "asset_hero_poster", title: "Hero poster" });
  const work = await addWork(env, project, {
    id: "hero_film",
    slug: "hero-film",
    kind: "video",
    title: "Hero film",
    createdAt: 10,
    posterAssetId: poster.id,
  });
  await env.DB.prepare(
    "INSERT INTO publication_derivatives(publication_id,kind,r2_key,mime,bytes,width,height,sha256,source_sha256,created_at) VALUES(?1,'poster',?2,'image/webp',10,640,360,'hero-preview-sha',?3,1)",
  )
    .bind(work.publicationId, "hero-preview-key", poster.sha256)
    .run();
  await env.MEDIA.put("hero-preview-key", PNG_1x1);
  await env.MEDIA.put(poster.r2_key, PNG_1x1);

  const home = await get(env, "/");
  const html = await home.text();
  assert.match(html, /class="gallery-hero-art"[^>]*><img src="\/p\/hero-film\/poster-preview"/);
  assert.match(html, /<img src="\/p\/hero-film\/poster-preview"[^>]*width="640" height="360"/);
  assert.doesNotMatch(html, /\/p\/hero-film\/(poster|media)"/);
  const preview = await get(env, "/p/hero-film/poster-preview");
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("cache-control"), `public, max-age=${PUBLIC_CACHE_SECONDS}`);
  assert.equal((await get(env, "/p/hero-film/poster")).status, 200);
});

test("the home hero keeps using a gallery thumb, and a work with no preview falls back honestly", async () => {
  const { env } = await setup();
  const project = await addProject(env, { id: "prj_still", name: "Still Studio", slug: "still-studio" });
  const work = await addWork(env, project, { id: "hero_still", slug: "hero-still", title: "Hero still", createdAt: 10 });
  await env.DB.prepare(
    "INSERT INTO publication_derivatives(publication_id,kind,r2_key,mime,bytes,width,height,sha256,created_at) VALUES(?1,'thumb','hero-thumb-key','image/webp',10,320,240,'hero-thumb-sha',1)",
  )
    .bind(work.publicationId)
    .run();
  await env.MEDIA.put("hero-thumb-key", PNG_1x1);
  const withThumb = await (await get(env, "/")).text();
  assert.match(withThumb, /class="gallery-hero-art"[^>]*><img src="\/p\/hero-still\/thumb"/);

  const plain = await setup();
  const plainProject = await addProject(plain.env, { id: "prj_plain", name: "Plain Studio", slug: "plain-studio" });
  await addWork(plain.env, plainProject, { id: "plain_still", slug: "plain-still", title: "Plain still", createdAt: 10 });
  const noPreview = await (await get(plain.env, "/")).text();
  // No stored preview exists for this work, so the full original is the only
  // honest image the page can show.
  assert.match(noPreview, /class="gallery-hero-art"[^>]*><img src="\/p\/plain-still\/media"/);
});

test("capability is derived from stored lineage and stays absent when it cannot be proven", async () => {
  const { env } = await setup();
  const project = await addProject(env, { id: "prj_cap", name: "Capability Studio", slug: "capability-studio" });
  const reference = await addPlainAsset(env, project, { id: "asset_cap_reference" });
  await addWork(env, project, { id: "cap_original", slug: "cap-original", createdAt: 1, request: { referenceAssetId: null } });
  await addWork(env, project, { id: "cap_variation", slug: "cap-variation", createdAt: 2, request: { referenceAssetId: reference.id } });
  await addWork(env, project, {
    id: "cap_variation_lineage",
    slug: "cap-variation-lineage",
    createdAt: 3,
    parentAssetId: reference.id,
    request: {},
  });
  await addWork(env, project, {
    id: "cap_refinement_mask",
    slug: "cap-refinement-mask",
    createdAt: 4,
    request: { maskAssetId: reference.id },
  });
  await addWork(env, project, {
    id: "cap_refinement_variant",
    slug: "cap-refinement-variant",
    createdAt: 5,
    source: "variant",
    parentAssetId: reference.id,
    model: "studio-cutout",
    request: {},
  });
  await addWork(env, project, {
    id: "cap_refinement_restyle",
    slug: "cap-refinement-restyle",
    createdAt: 6,
    kind: "video",
    parentAssetId: reference.id,
    model: "kling-o1-restyle",
    request: {},
  });
  await addWork(env, project, {
    id: "cap_assembled_composition",
    slug: "cap-assembled-composition",
    createdAt: 7,
    source: "assembled",
    compositionId: "composition_cap",
    request: {},
  });
  await addWork(env, project, {
    id: "cap_assembled_request",
    slug: "cap-assembled-request",
    createdAt: 8,
    kind: "video",
    request: { shots: [{ assetId: reference.id }] },
  });
  await addWork(env, project, { id: "cap_upload", slug: "cap-upload", createdAt: 9, source: "upload", generation: false });
  await addWork(env, project, { id: "cap_invalid", slug: "cap-invalid", createdAt: 10, invalidRequest: true });
  await addWork(env, project, { id: "cap_deleted", slug: "cap-deleted", createdAt: 11, generationDeleted: 12 });

  const expected = {
    original: ["cap-original"],
    variation: ["cap-variation", "cap-variation-lineage"],
    refinement: ["cap-refinement-mask", "cap-refinement-variant", "cap-refinement-restyle"],
    assembled: ["cap-assembled-composition", "cap-assembled-request"],
  };
  for (const [capability, want] of Object.entries(expected)) {
    const html = await (await get(env, `/gallery?capability=${capability}`)).text();
    assert.deepEqual(slugs(html).sort(), want.sort(), capability);
    const count = `${want.length} ${want.length === 1 ? "work" : "works"}`;
    assert.match(html, new RegExp(`data-total="${want.length}">${count}<`));
    assert.doesNotMatch(html, /cap-upload|cap-invalid|cap-deleted/);
  }
  const unfiltered = await (await get(env, "/gallery")).text();
  assert.equal(cards(unfiltered).length, 11);
  assert.match(unfiltered, /cap-upload/);
  assert.match(unfiltered, /cap-invalid/);
  assert.match(unfiltered, /cap-deleted/);
  assert.deepEqual(optionValues(unfiltered, "capability"), ["", "original", "variation", "refinement", "assembled"]);
});

test("the catalogue query count is fixed and does not grow with cards or pages", async () => {
  const { env } = await setup();
  const project = await addProject(env, { id: "prj_count", name: "Count Studio", slug: "count-studio" });
  for (let index = 0; index < 26; index += 1) {
    await addWork(env, project, {
      id: `count_${String(index).padStart(2, "0")}`,
      slug: `count-${index}`,
      createdAt: 500 + index,
    });
  }
  let statements = 0;
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => {
    statements += 1;
    return prepare(sql);
  };
  const first = await get(env, "/gallery?project=count-studio&kind=image&capability=original");
  const firstCount = statements;
  await first.text();
  statements = 0;
  const second = await get(env, "/gallery?project=count-studio&kind=image&capability=original&page=2");
  await second.text();
  assert.equal(statements, firstCount);
  assert.ok(firstCount <= 4, `gallery used ${firstCount} statements`);
  statements = 0;
  await (await get(env, "/gallery")).text();
  assert.ok(statements <= 4, `unfiltered gallery used ${statements} statements`);
});
