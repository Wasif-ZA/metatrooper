CREATE TABLE IF NOT EXISTS session_label (
  session_id TEXT NOT NULL REFERENCES session(id),
  name TEXT NOT NULL,
  PRIMARY KEY (session_id, name)
);
