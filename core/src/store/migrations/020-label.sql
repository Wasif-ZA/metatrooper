CREATE TABLE IF NOT EXISTS label (
  name TEXT PRIMARY KEY,
  colour TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_label (
  automation_id TEXT NOT NULL REFERENCES automation(id),
  name TEXT NOT NULL,
  PRIMARY KEY (automation_id, name)
);
