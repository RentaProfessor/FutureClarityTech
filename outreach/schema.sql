-- D1 schema for the outreach sequencer. Apply with:
--   npx wrangler d1 execute outreach --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS prospects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL DEFAULT '',
  business TEXT NOT NULL DEFAULT '',
  -- The one specific problem you observed. Required: this is the
  -- personalization that roughly doubles reply rates.
  observation TEXT NOT NULL,
  demo_url TEXT NOT NULL DEFAULT '',
  sequence TEXT NOT NULL,
  -- Next step index to send (0 = first email not yet sent).
  step INTEGER NOT NULL DEFAULT 0,
  -- active | replied | done | stopped | suppressed | bounced
  status TEXT NOT NULL DEFAULT 'active',
  last_sent_at TEXT,
  thread_id TEXT,
  called_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER NOT NULL REFERENCES prospects(id),
  step INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  gmail_id TEXT
);

-- Permanent do-not-contact list. Nothing on this list is ever emailed again,
-- including if re-added as a prospect.
CREATE TABLE IF NOT EXISTS suppressed (
  email TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
CREATE INDEX IF NOT EXISTS idx_sends_sent_at ON sends(sent_at);
