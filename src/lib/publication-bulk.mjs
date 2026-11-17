// MIT. Owner bulk visibility changes through the one publications table.
//
// A bulk action is one publication-table write per selected item: it is not a
// second publication authority and it never bypasses the Composer grant that
// `requireSession(..., "publish")` re-checks before this module runs. Items are
// attempted independently and reported one by one, so a partial failure says
// exactly what changed instead of pretending the whole set succeeded.
//
// Every actual state change appends an append-only audit row naming the actor,
// the action, the previous state and the resulting state. `hidden` stays a
// gallery-placement control and is never used as a synonym for private,
// unlisted or withdrawn.

import { HttpError, id, now, safeJson } from "./util.mjs";
import { deletePublicationDerivatives } from "./publication-derivatives.ts";

export const MAX_BULK_PUBLICATIONS = 100;
export const BULK_ACTIONS = Object.freeze(["publish", "unlist", "withdraw"]);

function stateOf(row) {
  return {
    listed: Boolean(row.listed),
    hidden: Boolean(row.hidden),
    withdrawn: Boolean(row.revoked_at),
  };
}

function actorOf(session) {
  return {
    actor: typeof session?.actor === "string" && session.actor ? session.actor.slice(0, 128) : "owner",
    actorName: typeof session?.actorName === "string" ? session.actorName.slice(0, 120) : null,
    mode: session?.mode === "bridge" ? "bridge" : "owner",
  };
}

function insertAudit(env, { projectId, publicationId, action, previous, resulting, stamp, actor, listed, hidden }) {
  // The SELECT only matches when the row really holds the state this action
  // just wrote, so the audit row and the change cannot disagree.
  return env.DB.prepare(
    `INSERT INTO publication_audit(id,project_id,publication_id,asset_id,actor,actor_name,session_mode,action,previous_state,resulting_state,created_at)
     SELECT ?1,p.project_id,p.id,p.asset_id,?2,?3,?4,?5,?6,?7,?8
     FROM publications p
     WHERE p.id=?9 AND p.project_id=?10 AND p.revoked_at IS NULL AND p.listed=?11 AND p.hidden=?12`,
  ).bind(
    id("audit"),
    actor.actor,
    actor.actorName,
    actor.mode,
    action,
    JSON.stringify(previous),
    JSON.stringify(resulting),
    stamp,
    publicationId,
    projectId,
    listed,
    hidden,
  );
}

/**
 * Change one bounded set of publications to `publish`, `unlist` or `withdraw`.
 *
 * Returns one result per requested publication:
 *   published | unlisted | withdrawn | unchanged | already_withdrawn |
 *   not_found | asset_unavailable | failed
 */
export async function bulkPublicationChange(env, projectId, { action, publicationIds, session } = {}) {
  if (!BULK_ACTIONS.includes(action))
    throw new HttpError(400, "Choose publish, unlist or withdraw.", "invalid_action");
  const requested = [...new Set((publicationIds ?? []).filter((value) => typeof value === "string"))];
  if (requested.length < 1 || requested.length > MAX_BULK_PUBLICATIONS)
    throw new HttpError(400, `Choose between 1 and ${MAX_BULK_PUBLICATIONS} publications.`, "invalid_selection");
  if (requested.some((value) => !/^pub_[a-z0-9_]+$/.test(value)))
    throw new HttpError(400, "One of the selected publication IDs is not valid.", "invalid_selection");

  const actor = actorOf(session);
  const results = [];
  for (const publicationId of requested) {
    try {
      const row = await env.DB.prepare(
        `SELECT p.id,p.project_id,p.asset_id,p.slug,p.listed,p.hidden,p.revoked_at,a.deleted_at AS asset_deleted
         FROM publications p JOIN assets a ON a.id=p.asset_id
         WHERE p.id=?1 AND p.project_id=?2`,
      )
        .bind(publicationId, projectId)
        .first();
      if (!row) {
        results.push({ publicationId, result: "not_found" });
        continue;
      }
      const previous = stateOf(row);
      if (row.revoked_at) {
        results.push({ publicationId, result: action === "withdraw" ? "already_withdrawn" : "withdrawn", previous });
        continue;
      }
      if (action === "publish" && row.asset_deleted) {
        results.push({ publicationId, result: "asset_unavailable", previous });
        continue;
      }
      if (action === "publish" && previous.listed && !previous.hidden) {
        results.push({ publicationId, result: "unchanged", previous, resulting: previous });
        continue;
      }
      if (action === "unlist" && !previous.listed) {
        results.push({ publicationId, result: "unchanged", previous, resulting: previous });
        continue;
      }

      const stamp = now();
      if (action === "withdraw") {
        const [update] = await env.DB.batch([
          env.DB.prepare(
            "UPDATE publications SET revoked_at=?3 WHERE id=?1 AND project_id=?2 AND revoked_at IS NULL",
          ).bind(row.id, projectId, stamp),
          env.DB.prepare(
            `INSERT INTO publication_audit(id,project_id,publication_id,asset_id,actor,actor_name,session_mode,action,previous_state,resulting_state,created_at)
             SELECT ?1,p.project_id,p.id,p.asset_id,?2,?3,?4,'withdraw',?5,?6,?7
             FROM publications p WHERE p.id=?8 AND p.project_id=?9 AND p.revoked_at=?10`,
          ).bind(
            id("audit"),
            actor.actor,
            actor.actorName,
            actor.mode,
            JSON.stringify(previous),
            JSON.stringify({ ...previous, withdrawn: true }),
            stamp,
            row.id,
            projectId,
            stamp,
          ),
        ]);
        if (!Number(update.meta?.changes ?? update.changes ?? 0)) {
          results.push({ publicationId, result: "unchanged", previous, resulting: previous });
          continue;
        }
        try {
          // Cached previews must stop with the page. A failed byte delete still
          // leaves the row withdrawn, and the page route checks withdrawal first.
          await deletePublicationDerivatives(env, [row.id]);
        } catch (error) {
          console.warn("Could not remove a withdrawn publication preview", row.id, error?.message);
        }
        results.push({
          publicationId,
          result: "withdrawn",
          previous,
          resulting: { ...previous, withdrawn: true },
        });
        continue;
      }

      const listed = action === "publish" ? 1 : 0;
      const hidden = action === "publish" ? 0 : (previous.hidden ? 1 : 0);
      const resulting = { listed: Boolean(listed), hidden: Boolean(hidden), withdrawn: false };
      const [update] = await env.DB.batch([
        env.DB.prepare(
          "UPDATE publications SET listed=?3,hidden=?4 WHERE id=?1 AND project_id=?2 AND revoked_at IS NULL",
        ).bind(row.id, projectId, listed, hidden),
        insertAudit(env, {
          projectId,
          publicationId: row.id,
          action,
          previous,
          resulting,
          stamp,
          actor,
          listed,
          hidden,
        }),
      ]);
      if (!Number(update.meta?.changes ?? update.changes ?? 0)) {
        results.push({ publicationId, result: "unchanged", previous, resulting: previous });
        continue;
      }
      results.push({
        publicationId,
        result: action === "publish" ? "published" : "unlisted",
        previous,
        resulting,
      });
    } catch (error) {
      // Keep the remaining items independent. The response names the failure
      // instead of turning a partial result into an all-or-nothing claim.
      results.push({
        publicationId,
        result: "failed",
        detail: error instanceof HttpError ? error.message : "This item could not be changed.",
      });
    }
  }

  const count = (name) => results.filter((item) => item.result === name).length;
  const withdrawnNow = action === "withdraw" ? count("withdrawn") : 0;
  return {
    action,
    requested: requested.length,
    changed: count("published") + count("unlisted") + withdrawnNow,
    unchanged: count("unchanged") + count("already_withdrawn"),
    blocked:
      count("failed") +
      count("not_found") +
      count("asset_unavailable") +
      (action === "withdraw" ? 0 : count("withdrawn")),
    results,
  };
}

/** The audit trail is owner-readable, bounded and limited to one project. */
export async function publicationAudit(env, projectId, limit = 50) {
  const bounded = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const rows = await env.DB.prepare(
    `SELECT id,publication_id,asset_id,actor,actor_name,session_mode,action,previous_state,resulting_state,created_at
     FROM publication_audit WHERE project_id=?1 ORDER BY created_at DESC,id DESC LIMIT ?2`,
  )
    .bind(projectId, bounded)
    .all();
  return rows.results.map((row) => ({
    id: row.id,
    publicationId: row.publication_id,
    assetId: row.asset_id,
    actor: row.actor,
    actorName: row.actor_name,
    sessionMode: row.session_mode,
    action: row.action,
    previousState: safeJson(row.previous_state, null),
    resultingState: safeJson(row.resulting_state, null),
    createdAt: row.created_at,
  }));
}
