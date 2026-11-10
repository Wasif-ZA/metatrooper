CREATE TABLE IF NOT EXISTS handoff (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES session(id),
  parent_id TEXT REFERENCES session(id), at TEXT NOT NULL, cwd TEXT,
  summary TEXT, files TEXT NOT NULL, transcript TEXT);
CREATE INDEX IF NOT EXISTS handoff_session ON handoff(session_id, at);
