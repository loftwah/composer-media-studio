// MIT. The private /compare page response assembly, moved out of worker.mjs for
// #198 so it is checked under strict TypeScript. The Worker keeps the route's
// place in its branch order and passes the existing session-derived project
// helpers; this module owns the signed-out login refusal and the read-only
// project, job and saved-take selection. Route matching, query handling, SQL,
// limits, model catalogue, renderer, revision and headers are unchanged.
//
import {
  projectAccessible,
  readSession,
  type StudioSession,
  type StudioSessionProject,
} from "./auth.ts";
import { comparePage } from "./compare-page.ts";
import {
  jobCatalogue,
  latestPerModel,
  likeForLike,
  verdict,
  weakness,
  type Entry,
  type JobId,
  type LikeForLikeResult,
  type Model,
  type SavedGenerationRow,
} from "./comparisons.ts";
import { loginPage } from "./studio-shell.ts";

/** The D1 statement members this branch calls. `run` keeps the seam
 *  assignable to auth's readSession environment without being invoked here. */
interface CompareStatement {
  bind(...values: unknown[]): CompareStatement;
  first<Row = unknown>(): Promise<Row | null>;
  all<Row>(): Promise<{ results: Row[] }>;
  run(): Promise<unknown>;
}

/** The only env members this branch reads. Callers pass the real Worker env. */
export interface CompareRouteEnv {
  DB: { prepare(query: string): CompareStatement };
  SESSION_SECRET?: string;
  BRIDGE_SECRET?: string;
  COMPOSER_ORIGIN?: string;
  PUBLIC_STORY_URL?: string;
  WOODHOUSE_SHARE?: string;
}

/** A project as the existing project helpers return it. D1's `*` projection
 *  carries every column, but this branch reads only these. */
export interface CompareProjectRow extends StudioSessionProject {
  name: string;
  updated_at?: number | string | null;
}

/** One accessible studio offered by the no-project page. */
interface CompareProjectCandidateRow extends CompareProjectRow {
  workspace_id?: string | null;
  updated_at: number | string;
}

/** A saved take plus the preview path the Worker adds to each entry. */
type PreviewEntry = Entry & { previewUrl: string | null };

/** The Worker-supplied inputs: its build revision, the one served model
 *  catalogue, and the existing project helpers that live in worker.mjs or
 *  jobs.mjs. Passing them keeps this module from importing the Worker or
 *  duplicating its project selection. */
export interface CompareRouteDeps {
  revision: string;
  models: Record<string, Model>;
  currentProject(
    env: CompareRouteEnv,
    session: StudioSession,
  ): Promise<CompareProjectRow | null>;
  loadProject(
    env: CompareRouteEnv,
    projectId: string,
    options: { required: false },
  ): Promise<CompareProjectRow | null>;
}

/**
 * Build the private `/compare` response. The Worker matches the route.
 *
 * There is deliberately no method check: this path answered every method
 * before the extraction and still does. The signed-out response is the login
 * page with a 401, exactly as before.
 */
export async function compareRouteResponse(
  request: Request,
  env: CompareRouteEnv,
  url: URL,
  deps: CompareRouteDeps,
): Promise<Response> {
  const session = await readSession(env, request);
  if (!session) {
    return new Response(
      loginPage({
        next: "/compare",
        revision: deps.revision,
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
  let project: CompareProjectRow | null = null;
  if (requestedProject) {
    const candidate = await deps.loadProject(env, requestedProject, { required: false });
    if (candidate && projectAccessible(session, candidate)) project = candidate;
  } else {
    project = await deps.currentProject(env, session);
  }

  if (!project) {
    const { results: candidates } = await env.DB.prepare(
      "SELECT id,name,workspace_id,updated_at FROM projects ORDER BY updated_at DESC LIMIT 60",
    ).all<CompareProjectCandidateRow>();
    const projects = candidates
      .filter((candidate) => projectAccessible(session, candidate))
      .map((candidate) => ({ id: candidate.id, name: candidate.name, updatedAt: candidate.updated_at }));
    return new Response(
      comparePage({
        revision: deps.revision,
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
        models: deps.models,
      }),
      { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
    );
  }

  const jobs = jobCatalogue(deps.models);
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
    .all<SavedGenerationRow>();

  const byJob = new Map<JobId, LikeForLikeResult<PreviewEntry>>();
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
      revision: deps.revision,
      jobs,
      job,
      project,
      entries,
      verdict: verdict({ ...review, models: deps.models }),
      weakness: weakness(review),
      excluded,
      briefNote,
      session,
      composerOrigin: env.COMPOSER_ORIGIN,
      storyUrl: env.PUBLIC_STORY_URL,
      woodhouseShare: env.WOODHOUSE_SHARE === "true",
      models: deps.models,
    }),
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}
