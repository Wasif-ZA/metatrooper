CREATE TABLE IF NOT EXISTS session_step (
  session_id TEXT NOT NULL REFERENCES session(id),
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, idx)
);
