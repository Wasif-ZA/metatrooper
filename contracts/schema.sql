-- Agent Harness store. File: ~/.agent-harness/harness.db
-- Opened by every writer with:
--   PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 200; PRAGMA foreign_keys = ON;
-- Windows keep one read-only connection (mode=ro) for all reads, and open a short-lived read-write
-- connection only to insert rows into `command` and `comment`.
-- All timestamps are ISO 8601 with offset, e.g. 2026-09-29T14:05:00.123+10:00.
-- All ids are text: ULIDs unless stated.
-- Ownership: the core is the only writer of every table except the three queue tables
-- (`event`: hooks, launcher, notify wrapper; `command`: windows and CLI; `comment`: workbench).

PRAGMA user_version = 1;

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- rows: ('schema_version','1'), ('core_pid', ...), ('core_heartbeat', <ts, updated every 2 s>)

CREATE TABLE project (
  id          TEXT PRIMARY KEY,               -- sha1 hex of the canonical path (see pipe-protocol.md, project.open)
  path        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  opened_at   TEXT NOT NULL,
  last_opened TEXT NOT NULL
);

CREATE TABLE engine (
  id          TEXT PRIMARY KEY,               -- 'claude', 'codex', 'agy', or plugin-defined
  plugin_id   TEXT REFERENCES plugin(id),     -- NULL for built-ins
  spec_json   TEXT NOT NULL,                  -- the registry entry, validated against plugin-manifest.schema.json#/$defs/engine
  cost_rank   INTEGER NOT NULL,
  provider    TEXT NOT NULL CHECK (provider IN ('local-cli','api-key','gateway')) DEFAULT 'local-cli'
);

CREATE TABLE engine_check (
  engine_id   TEXT NOT NULL REFERENCES engine(id),
  checked_at  TEXT NOT NULL,
  installed   INTEGER NOT NULL,
  version     TEXT,
  auth        TEXT NOT NULL CHECK (auth IN ('ok','missing','unknown')),
  detail      TEXT,
  PRIMARY KEY (engine_id, checked_at)
);

CREATE TABLE session (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES project(id),
  engine_id     TEXT NOT NULL REFERENCES engine(id),
  host          TEXT NOT NULL CHECK (host IN ('wt','herdr')),
  window_name   TEXT,                          -- wt: 'harness-<first 8 of id>'; herdr: NULL
  herdr_pane    TEXT,                          -- herdr: 'w1:p2'; wt: NULL
  pid           INTEGER,                       -- powershell pid from launch.ps1 (wt) or pane shell pid (herdr)
  native_id     TEXT,                          -- claude session_id, codex thread-id, agy conversation id
  run_id        TEXT REFERENCES run(id),
  step_id       TEXT,
  state         TEXT NOT NULL CHECK (state IN ('starting','working','waiting_for_you','done','idle','unknown','exited')),
  state_at      TEXT NOT NULL,
  last_tool     TEXT,
  hidden        INTEGER NOT NULL DEFAULT 0,
  started_at    TEXT NOT NULL,
  ended_at      TEXT
);
CREATE INDEX session_project_idx ON session (project_id, started_at);
CREATE INDEX session_native_idx  ON session (native_id);

-- Queue 1: append-only, written by hooks, launch.ps1 and the codex notify wrapper.
CREATE TABLE event (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('claude-hook','launch','codex-notify','herdr','core')),
  session_id  TEXT,                            -- HARNESS_SESSION_ID when present
  kind        TEXT NOT NULL,                   -- see events.md
  payload     TEXT NOT NULL,                   -- JSON, shape per kind in events.md
  processed   INTEGER NOT NULL DEFAULT 0       -- set to 1 by the core only
);
CREATE INDEX event_unprocessed_idx ON event (processed, seq);

-- Queue 2: commands that could not be delivered over the pipe within 300 ms.
CREATE TABLE command (
  id          TEXT PRIMARY KEY,                -- the JSON-RPC request id, so a pipe retry and a queued copy dedupe
  at          TEXT NOT NULL,
  origin      TEXT NOT NULL CHECK (origin IN ('workbench','tray','cli')),
  method      TEXT NOT NULL,
  params      TEXT NOT NULL,                   -- JSON
  status      TEXT NOT NULL CHECK (status IN ('queued','accepted','running','ok','error')) DEFAULT 'queued',
  result      TEXT,                            -- JSON result or error object
  done_at     TEXT
);
CREATE INDEX command_status_idx ON command (status, at);

-- Queue 3: point-to-comment and diff comments waiting for delivery.
CREATE TABLE comment (
  id           TEXT PRIMARY KEY,
  at           TEXT NOT NULL,
  session_id   TEXT NOT NULL REFERENCES session(id),
  kind         TEXT NOT NULL CHECK (kind IN ('element','diff-line','file')),
  body         TEXT NOT NULL,                  -- the formatted block delivered to the agent; starts with [comment <id>]
  crop_path    TEXT,
  clipboard_at TEXT,                           -- copied to the clipboard
  prompt_at    TEXT,                           -- printed by the UserPromptSubmit hook (Claude)
  herdr_at     TEXT                            -- sent with herdr agent.prompt
);
CREATE INDEX comment_prompt_idx ON comment (session_id, prompt_at);

CREATE TABLE pipeline (
  id          TEXT PRIMARY KEY,                -- pipeline.json "id"
  source      TEXT NOT NULL,                   -- 'builtin', 'template', 'plugin:<id>', 'project'
  path        TEXT NOT NULL,
  version     INTEGER NOT NULL,
  valid       INTEGER NOT NULL,
  errors      TEXT                             -- JSON array of validation errors when valid = 0
);

CREATE TABLE run (
  id           TEXT PRIMARY KEY,
  pipeline_id  TEXT NOT NULL REFERENCES pipeline(id),
  parent_run   TEXT REFERENCES run(id),        -- set for a sub-pipeline run (kind: pipeline)
  parent_step  TEXT,
  depth        INTEGER NOT NULL DEFAULT 0 CHECK (depth <= 3),
  project_id   TEXT NOT NULL REFERENCES project(id),
  inputs       TEXT NOT NULL,                  -- JSON
  run_dir      TEXT NOT NULL,                  -- <project>/.harness/runs/<run id>/
  status       TEXT NOT NULL CHECK (status IN ('running','paused','failed','done','cancelled')),
  paused_why   TEXT,                           -- 'gate', 'budget', 'loop-max', 'breaker', 'handoff'
  trigger      TEXT NOT NULL CHECK (trigger IN ('manual','schedule','cli')),
  max_tokens   INTEGER NOT NULL,
  max_usd      REAL NOT NULL,
  max_minutes  INTEGER NOT NULL,
  started_at   TEXT NOT NULL,
  ended_at     TEXT
);

CREATE TABLE run_step (
  run_id       TEXT NOT NULL REFERENCES run(id),
  step_id      TEXT NOT NULL,
  iteration    INTEGER NOT NULL DEFAULT 0,     -- loop iteration
  fanout_index INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL CHECK (status IN ('pending','running','waiting','done','failed','skipped')),
  engine_id    TEXT REFERENCES engine(id),
  session_id   TEXT REFERENCES session(id),
  output_path  TEXT,                           -- <run_dir>/<step_id>[-<i>].md
  outputs      TEXT,                           -- JSON parsed from the output file's front matter
  fail_count   INTEGER NOT NULL DEFAULT 0,
  started_at   TEXT,
  ended_at     TEXT,
  PRIMARY KEY (run_id, step_id, iteration, fanout_index)
);

CREATE TABLE gate (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES run(id),
  step_id      TEXT NOT NULL,                  -- the gate step
  guards_step  TEXT,                           -- the publish/external step it protects, NULL for plain approvals
  kind         TEXT NOT NULL CHECK (kind IN ('approve','handoff','auto-external')),
  action_hash  TEXT,                           -- sha256 of canonical JSON {step, action, args, destination}; required when guards_step is set
  summary      TEXT NOT NULL,                  -- what the user is approving, in words
  status       TEXT NOT NULL CHECK (status IN ('waiting','approved','rejected','stale')),
  decided_at   TEXT,
  note         TEXT
);

CREATE TABLE plugin (
  id           TEXT PRIMARY KEY,
  version      TEXT NOT NULL,
  path         TEXT NOT NULL,
  manifest     TEXT NOT NULL,                  -- JSON
  source       TEXT NOT NULL CHECK (source IN ('native','claude-import','codex-import','agy-import','builtin')),
  permissions  TEXT NOT NULL,                  -- JSON array, as approved by the user at install
  enabled      INTEGER NOT NULL DEFAULT 1,
  installed_at TEXT NOT NULL
);

CREATE TABLE browser_pane (
  id           TEXT PRIMARY KEY,               -- 'bp_<ulid>'
  project_id   TEXT NOT NULL REFERENCES project(id),
  run_id       TEXT REFERENCES run(id),
  variant      INTEGER,                        -- fan-out index when owned by a variant
  session_id   TEXT REFERENCES session(id),    -- the one session allowed to drive it; NULL = user only
  url          TEXT,
  dev_port     INTEGER,
  open         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE snapshot (
  id           TEXT PRIMARY KEY,
  pane_id      TEXT NOT NULL REFERENCES browser_pane(id),
  label        TEXT NOT NULL CHECK (label IN ('before','after','reference','comment')),
  url          TEXT NOT NULL,
  taken_at     TEXT NOT NULL,
  w390_path    TEXT,
  w1280_path   TEXT
);

CREATE TABLE board_item (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES run(id),
  source_url   TEXT NOT NULL,
  capture_path TEXT,
  reason       TEXT NOT NULL,
  pinned       INTEGER NOT NULL DEFAULT 0,
  removed      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE port_lease (
  port         INTEGER PRIMARY KEY,            -- allocated by the core only, lowest free at or above 3001
  run_id       TEXT NOT NULL REFERENCES run(id),
  idx          INTEGER NOT NULL,
  leased_at    TEXT NOT NULL
);

CREATE TABLE plugin_secret (
  plugin_id    TEXT NOT NULL REFERENCES plugin(id),
  name         TEXT NOT NULL,                  -- env key
  blob_path    TEXT NOT NULL,                  -- ~/.agent-harness/secrets/<plugin>/<name>.dpapi, DPAPI CurrentUser
  set_at       TEXT NOT NULL,
  PRIMARY KEY (plugin_id, name)
);

CREATE TABLE dev_server (
  run_id       TEXT NOT NULL REFERENCES run(id),
  idx          INTEGER NOT NULL,
  port         INTEGER NOT NULL REFERENCES port_lease(port),
  pid          INTEGER,
  status       TEXT NOT NULL CHECK (status IN ('starting','ready','failed','stopped')),
  started_at   TEXT NOT NULL,
  PRIMARY KEY (run_id, idx)
);

CREATE TABLE variant (
  run_id       TEXT NOT NULL REFERENCES run(id),
  idx          INTEGER NOT NULL,
  worktree     TEXT NOT NULL,
  branch       TEXT NOT NULL,
  dev_port     INTEGER NOT NULL,
  pane_id      TEXT REFERENCES browser_pane(id),
  status       TEXT NOT NULL CHECK (status IN ('building','ready','picked','discarded')),
  PRIMARY KEY (run_id, idx)
);

-- Open-core usage ledger: one row per finished step per engine turn source.
CREATE TABLE usage (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  run_id       TEXT REFERENCES run(id),
  step_id      TEXT,
  session_id   TEXT REFERENCES session(id),
  engine_id    TEXT NOT NULL,
  provider     TEXT NOT NULL CHECK (provider IN ('local-cli','api-key','gateway')),
  model        TEXT,
  tokens_in    INTEGER,
  tokens_out   INTEGER,
  cache_read   INTEGER,
  cache_write  INTEGER,
  usd          REAL,                           -- NULL when the model price is unknown
  source       TEXT NOT NULL CHECK (source IN ('transcript','codex-session','callrouter','gateway','unknown')),
  dedupe_key   TEXT NOT NULL UNIQUE            -- claude: message.id; codex: turn id; else '<session>:<step>:<n>'
);

CREATE TABLE limit_reading (
  provider     TEXT NOT NULL,                  -- 'claude', 'codex', ...
  account      TEXT NOT NULL,
  window       TEXT NOT NULL,                  -- '5h', 'daily', 'weekly', 'weekly-model'
  used_pct     REAL,
  resets_at    TEXT,
  read_at      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('ok','unavailable','not-signed-in')),
  PRIMARY KEY (provider, account, window)
);

CREATE TABLE schedule (
  id           TEXT PRIMARY KEY,
  pipeline_id  TEXT NOT NULL REFERENCES pipeline(id),
  project_id   TEXT NOT NULL REFERENCES project(id),
  cron         TEXT NOT NULL,                  -- 5-field cron, local time
  inputs       TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  last_fired   TEXT,
  last_missed  TEXT                            -- set when the core was down at a fire time; never back-filled
);
