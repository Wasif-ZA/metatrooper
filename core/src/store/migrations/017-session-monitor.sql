CREATE TABLE IF NOT EXISTS session_monitor (
  session_id TEXT PRIMARY KEY REFERENCES session(id),
  automation_id TEXT NOT NULL REFERENCES automation(id),
  last_run_id TEXT
);
