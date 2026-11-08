CREATE TABLE IF NOT EXISTS automation (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id),
  name TEXT NOT NULL,
  every_min INTEGER NOT NULL CHECK (every_min >= 1),
  runner TEXT NOT NULL,            -- JSON array, argv prefix, e.g. ["bash"] or ["powershell","-File"]
  script TEXT NOT NULL,            -- path relative to the project folder
  script_sha256 TEXT NOT NULL,     -- pinned when a user (ctx.ui) saves the automation
  timeout_ms INTEGER NOT NULL DEFAULT 60000,
  engine_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_due TEXT NOT NULL,          -- ISO time (nowIso)
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_run (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL REFERENCES automation(id),
  due_at TEXT NOT NULL,
  at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('skip', 'woke', 'failed', 'missed')),
  exit_code INTEGER,
  detail TEXT,
  session_id TEXT
);
CREATE INDEX IF NOT EXISTS automation_run_idx ON automation_run(automation_id, at);
