-- Private, project-owned editorial drafts; no media or provider jobs.
CREATE TABLE promo_briefs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  spec_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX promo_briefs_project ON promo_briefs(project_id, updated_at DESC);
