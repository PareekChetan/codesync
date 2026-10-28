-- Users who can sign in.
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A room is one shared document. The id is a short, URL-friendly slug.
CREATE TABLE IF NOT EXISTS rooms (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  language   TEXT NOT NULL DEFAULT 'javascript',
  owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Everyone who has opened a room, so it shows up on their dashboard.
CREATE TABLE IF NOT EXISTS room_members (
  room_id   TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);

-- The CRDT state of each document, stored as one compact binary snapshot.
-- Storing the merged Yjs state (not individual edits) keeps reads O(1).
CREATE TABLE IF NOT EXISTS documents (
  room_id    TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  state      BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
