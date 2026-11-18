# Media Studio source map

Media Studio owns its Worker, D1, R2, jobs and releases. Composer supplies the
reviewed app brief and owner entry. The [product contract](../PRODUCT.md) and
[agent instructions](../AGENTS.md) describe the operating boundaries.

| Area | Entry and dependencies |
| --- | --- |
| Worker and storage | [wrangler.jsonc](../wrangler.jsonc) binds [src/worker.mjs](../src/worker.mjs) to the app's D1 and R2. [Migrations](../migrations) define the persisted contracts. The Worker owns route dispatch and calls the shared services below. |
| Identity and access | [auth.mjs](../src/lib/auth.mjs) provides session and Composer handoff checks. The Worker applies project and asset access before routing ordinary browser requests. |
| Local tools | The Worker serves `/tools/images` without an account. [home.tsx](../src/frontend/home.tsx) mounts [images.tsx](../src/frontend/images.tsx). Local selection, rendering and export stay in the browser. An explicit import of a derivative uses the separate Studio upload path and its access checks. |
| Paid jobs | [jobs.mjs](../src/lib/jobs.mjs) handles admission, budget, idempotency and retained results. [providers.mjs](../src/lib/providers.mjs) owns model declarations, inputs and provider dispatch. A new UI or agent action should use these existing job paths. |
| Agent tools | [oauth.mjs](../src/mcp/oauth.mjs) validates the Studio grant. [tools.mjs](../src/mcp/tools.mjs) calls the existing Worker API routes within that scope. Generation uses client request identity and the configured spend limit. |
| Public work | [publication-policy.ts](../src/lib/publication-policy.ts) controls publication eligibility. [publication-derivatives.ts](../src/lib/publication-derivatives.ts) handles public derivatives. [sitemap.ts](../src/lib/sitemap.ts) selects public listings for discovery. Originals, public media and withdrawal keep separate access paths. |

## Changing a boundary

Keep authorization at the Worker and job services when extracting a route or
view. A pure browser transform can live beside Image Tools. An action that
writes saved work or dispatches a model should retain the existing project,
asset, job and grant identities.

The typed [sitemap extraction](https://github.com/loftwah/composer-media-studio/pull/234)
preserved production origin and publication eligibility. The [typed preview
rendition](https://github.com/loftwah/composer-media-studio/pull/235) retained the
same published poster and thumbnail. These are examples of extracting small
production seams while preserving existing media.

Character Studio needs stable project-owned characters, versioned reference
roles and provenance. Changes should use the same job and permission paths.
[Studio #2](https://github.com/loftwah/composer-media-studio/issues/2) records
the architecture and ownership acceptance that remains to be demonstrated.

## Check and release

- Use the focused tests for the affected route or data boundary. For public
  discovery, run `node --import ./tests/support/workers-runtime.mjs --test tests/sitemap-withdrawal.test.mjs`.
- From clean, reviewed, pushed main, `pnpm deploy` runs Studio's guarded
  checks, build, upload and exact live verification. Exercise the changed
  workflow on the served revision. Repository-only documentation finishes
  on main with its link and contract checks.
