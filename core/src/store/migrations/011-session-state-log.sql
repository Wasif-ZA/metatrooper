CREATE TABLE IF NOT EXISTS session_state_log (
  session_id TEXT NOT NULL REFERENCES session(id),
  at TEXT NOT NULL,
  state TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS session_state_log_session ON session_state_log(session_id, at);
