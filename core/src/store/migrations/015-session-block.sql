CREATE TABLE IF NOT EXISTS session_block (
  blocked_id TEXT NOT NULL REFERENCES session(id),
  blocker_id TEXT NOT NULL REFERENCES session(id),
  PRIMARY KEY (blocked_id, blocker_id)
);
CREATE INDEX IF NOT EXISTS session_block_blocker ON session_block(blocker_id);
