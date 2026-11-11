CREATE TABLE IF NOT EXISTS session_review (
  session_id TEXT NOT NULL REFERENCES session(id),
  kind TEXT NOT NULL CHECK (kind IN ('reviewer','approver')),
  who TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','passed','failed')),
  note TEXT,
  review_session_id TEXT REFERENCES session(id),
  at TEXT NOT NULL,
  PRIMARY KEY (session_id, kind, who)
);
