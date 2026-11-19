CREATE TABLE handoff_next (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id),
  parent_id TEXT REFERENCES session(id),
  to_session TEXT REFERENCES session(id),
  at TEXT NOT NULL,
  cwd TEXT,
  summary TEXT,
  files TEXT NOT NULL,
  transcript TEXT
);
INSERT INTO handoff_next (id, session_id, parent_id, at, cwd, summary, files, transcript)
  SELECT id, session_id, parent_id, at, cwd, summary, files, transcript FROM handoff;
DROP TABLE handoff;
ALTER TABLE handoff_next RENAME TO handoff;
CREATE INDEX handoff_session ON handoff(session_id, at);
