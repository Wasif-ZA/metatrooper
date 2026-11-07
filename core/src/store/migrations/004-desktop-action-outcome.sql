CREATE TABLE IF NOT EXISTS desktop_action_outcome (
  action_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id),
  target TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'unverifiable', 'released')),
  updated_at TEXT NOT NULL,
  window INTEGER NOT NULL,
  verify_title_hash TEXT
);
