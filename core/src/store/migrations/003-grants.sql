-- 003: grant (M6-15). Body matches contracts/schema.sql.
CREATE TABLE IF NOT EXISTS grant (
  id           TEXT PRIMARY KEY,               -- 'gr_<ulid>'
  session_id   TEXT NOT NULL REFERENCES session(id),
  hwnd         INTEGER NOT NULL,
  pid          INTEGER NOT NULL,
  process_start TEXT NOT NULL,                 -- the process creation time, so a reused pid never matches
  exe          TEXT NOT NULL,
  title        TEXT NOT NULL,                  -- at grant time, shown on the tile
  created_at   TEXT NOT NULL,
  ended_at     TEXT                            -- window closed, process ended, revoked, or core restarted
);
CREATE INDEX IF NOT EXISTS grant_live_idx ON grant (ended_at, session_id);
