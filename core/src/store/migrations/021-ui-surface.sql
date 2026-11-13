CREATE TABLE IF NOT EXISTS ui_surface (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id),
  project_id TEXT NOT NULL REFERENCES project(id),
  zone TEXT NOT NULL,
  title TEXT NOT NULL,
  catalogue TEXT NOT NULL,
  spec TEXT NOT NULL,
  status TEXT NOT NULL,
  seq INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ui_surface_project_idx ON ui_surface (project_id, seq);
