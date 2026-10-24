-- Blackboard for peer agents, in Postgres.
--
-- Same model as the file version: each agent appends to its own log, everyone reads
-- everyone, and each reader keeps one cursor per author. Postgres takes over the parts
-- the files had to fake:
--   two agents claim one name   -> primary key on agents.name
--   a reader sees half an entry -> an entry is one row, written in one transaction
--   a quote poses as an entry   -> author and kind are columns, not text in the body
--   a reader skips an entry     -> per-author seq, assigned under a row lock (see bb.log)
--
-- Run once on an empty database:  psql -d <db> -f blackboard/schema.sql
--
--   register  INSERT INTO bb.agents (name, role, cwd) VALUES ('dev', 'builds things', '/path');
--   log       SELECT bb.log('dev', 'obs', 'text');
--   read      SELECT * FROM bb.read('dev');          -- bb.read('dev', true) replays everything
--   who       SELECT * FROM bb.who;
--
-- Use the default READ COMMITTED isolation and keep each call in its own short transaction.

CREATE SCHEMA bb;

CREATE TYPE bb.kind AS ENUM ('obs', 'claim', 'done', 'ask', 'reply', 'warn');

CREATE TABLE bb.agents (
  name          text PRIMARY KEY CHECK (name ~ '^[a-z0-9][a-z0-9-]*$'),
  role          text NOT NULL CHECK (role <> '' AND role !~ '[\r\n]'),
  cwd           text NOT NULL CHECK (cwd !~ '[\r\n]'),
  registered_at timestamptz NOT NULL DEFAULT now(),
  last_seq      bigint NOT NULL DEFAULT 0,  -- seq of this agent's latest entry; only bb.log changes it
  last_read_at  timestamptz                 -- heartbeat; bb.read sets it
);

-- A global serial id would not be a safe cursor: ids are handed out before commit, so
-- id 8 can commit before id 7, and a reader that has seen 8 skips 7 for good. seq is
-- per author and gapless, and bb.log makes each author's entries commit in seq order.
CREATE TABLE bb.entries (
  author     text NOT NULL REFERENCES bb.agents (name),
  seq        bigint NOT NULL,
  kind       bb.kind NOT NULL,
  body       text NOT NULL CHECK (body <> '' AND octet_length(body) <= 24000),  -- protocol size, not a concurrency limit
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (author, seq)
);

CREATE TABLE bb.cursors (
  reader   text NOT NULL REFERENCES bb.agents (name),
  author   text NOT NULL REFERENCES bb.agents (name),
  last_seq bigint NOT NULL,
  PRIMARY KEY (reader, author)
);

-- Entries are append-only: post a correction instead of editing.
CREATE FUNCTION bb.forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'bb.entries is append-only; post a correction instead';
END $$;

CREATE TRIGGER entries_append_only BEFORE UPDATE OR DELETE ON bb.entries
  FOR EACH ROW EXECUTE FUNCTION bb.forbid_change();
CREATE TRIGGER entries_no_truncate BEFORE TRUNCATE ON bb.entries
  FOR EACH STATEMENT EXECUTE FUNCTION bb.forbid_change();

CREATE FUNCTION bb.log(p_author text, p_kind bb.kind, p_body text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_seq bigint;
BEGIN
  -- Bumping last_seq locks the author's row until commit, so a second write by the same
  -- author waits for the first to commit. Seq N+1 can never be visible before seq N.
  UPDATE bb.agents SET last_seq = last_seq + 1 WHERE name = p_author RETURNING last_seq INTO v_seq;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent % is not registered', p_author;
  END IF;
  INSERT INTO bb.entries (author, seq, kind, body) VALUES (p_author, v_seq, p_kind, p_body);
  RETURN v_seq;
END $$;

-- Returns entries from other agents since this reader's last read, and advances the
-- cursors in the same statement, from the same snapshot, so nothing is skipped or lost.
CREATE FUNCTION bb.read(p_reader text, p_all boolean DEFAULT false)
RETURNS TABLE (author text, seq bigint, kind bb.kind, body text, created_at timestamptz, mentions_me boolean)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
BEGIN
  UPDATE bb.agents SET last_read_at = now() WHERE name = p_reader;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent % is not registered', p_reader;
  END IF;

  RETURN QUERY
  WITH new AS (
    SELECT e.*
    FROM bb.entries e
    LEFT JOIN bb.cursors c ON c.reader = p_reader AND c.author = e.author
    WHERE e.author <> p_reader AND (p_all OR e.seq > coalesce(c.last_seq, 0))
  ), advance AS (
    INSERT INTO bb.cursors (reader, author, last_seq)
    SELECT p_reader, n.author, max(n.seq) FROM new n GROUP BY n.author
    ON CONFLICT ON CONSTRAINT cursors_pkey
      DO UPDATE SET last_seq = greatest(bb.cursors.last_seq, excluded.last_seq)
  )
  SELECT n.author, n.seq, n.kind, n.body, n.created_at,
         n.body ~ ('@' || p_reader || '([^a-z0-9-]|$)')  -- names are [a-z0-9-], so safe in a regex
  FROM new n
  ORDER BY n.created_at, n.author, n.seq;
END $$;

CREATE VIEW bb.who AS
  SELECT name, role, cwd, registered_at, last_seq AS entries, last_read_at
  FROM bb.agents
  ORDER BY registered_at;
