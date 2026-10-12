-- 002: session_port and session_dev_server (M6-3, D60). Bodies match contracts/schema.sql.
CREATE TABLE IF NOT EXISTS session_port (                   -- ports leased to a session (worktree dev servers)
  port         INTEGER PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES session(id),
  leased_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_dev_server (             -- dev servers seen in a session's terminal
  id           TEXT PRIMARY KEY,               -- 'ds_<ulid>'
  session_id   TEXT NOT NULL REFERENCES session(id),
  project_id   TEXT NOT NULL REFERENCES project(id),
  port         INTEGER NOT NULL,
  url          TEXT NOT NULL,
  pid          INTEGER,                        -- the listening process when found
  matched_by   TEXT NOT NULL CHECK (matched_by IN ('ancestry','printed')),
  status       TEXT NOT NULL CHECK (status IN ('ready','stopped')),
  seen_at      TEXT NOT NULL
);
