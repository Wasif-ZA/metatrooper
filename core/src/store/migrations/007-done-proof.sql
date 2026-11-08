-- 007: done_proof (M8-F1), the check runs that back a session's done claim.
CREATE TABLE IF NOT EXISTS done_proof (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, at TEXT NOT NULL,
  revision TEXT, tree TEXT, command TEXT NOT NULL, environment TEXT NOT NULL,
  acceptance TEXT, exit_code INTEGER, output_tail TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS done_proof_session ON done_proof(session_id, at);
