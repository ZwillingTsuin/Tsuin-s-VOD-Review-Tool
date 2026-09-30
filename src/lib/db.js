// node:sqlite with numbered migrations (PRAGMA user_version). Add new ones at the end, never edit a shipped one,
// and keep them additive: during an update the old version may still be running on the same file.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DB_FILE } from './paths.js';

const MIGRATIONS = [
  // 1: first version
  `
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT);

  -- your Riot accounts (tracked in Match History and Insights)
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    riot_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
    puuid TEXT, region TEXT,
    in_insights INTEGER NOT NULL DEFAULT 1,   -- 0: a smurf in lower lobbies, left out of Insights unless picked
    rank_json TEXT, error TEXT,
    mmr_sig TEXT, checked_at INTEGER, history_at INTEGER, matches_synced_at INTEGER,
    added_at INTEGER NOT NULL
  );

  -- the pros you study: several Riot accounts each, an optional Twitch channel and its stream delay
  CREATE TABLE pros (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    twitch TEXT, vod_delay INTEGER,
    match_limit INTEGER NOT NULL DEFAULT 150,
    added_at INTEGER NOT NULL
  );
  CREATE TABLE pro_accounts (
    pro_id TEXT NOT NULL REFERENCES pros(id) ON DELETE CASCADE,
    riot_id TEXT NOT NULL COLLATE NOCASE,
    puuid TEXT, region TEXT, synced_at INTEGER, error TEXT,
    PRIMARY KEY (pro_id, riot_id)
  );

  -- one row per player per stored match (yours: owner 'me', a pro's: owner = pro id)
  CREATE TABLE matches (
    match_id TEXT NOT NULL, puuid TEXT NOT NULL, owner TEXT NOT NULL,
    date TEXT NOT NULL, map TEXT, agent TEXT, agent_id TEXT, region TEXT, season TEXT,
    won INTEGER, rounds_won INTEGER, rounds_lost INTEGER,
    kills INTEGER, deaths INTEGER, assists INTEGER, score INTEGER,
    head INTEGER, body INTEGER, leg INTEGER, dmg INTEGER, tier INTEGER,
    party INTEGER, lobby_avg REAL,            -- from the full match once it is downloaded
    PRIMARY KEY (match_id, puuid)
  );
  CREATE INDEX matches_owner_date ON matches (owner, date DESC);

  -- RR won or lost per match (from the MMR history)
  CREATE TABLE rr (match_id TEXT NOT NULL, puuid TEXT NOT NULL, rr INTEGER, PRIMARY KEY (match_id, puuid));

  -- moments in Twitch VODs: a pro's clutch / retake / … or a whole game (yours: player 'me')
  CREATE TABLE plays (
    id INTEGER PRIMARY KEY,
    player TEXT NOT NULL, channel TEXT, vod_id TEXT NOT NULL, vod_start TEXT NOT NULL, expires TEXT,
    t INTEGER NOT NULL, kind TEXT NOT NULL,
    match_id TEXT NOT NULL, puuid TEXT NOT NULL, round INTEGER NOT NULL DEFAULT 0,
    map TEXT, agent TEXT, agent_id TEXT, role TEXT, side TEXT, site TEXT,
    label TEXT, score REAL, reviewed INTEGER NOT NULL DEFAULT 0,
    UNIQUE (match_id, puuid, round, kind)
  );
  CREATE INDEX plays_player ON plays (player, kind);

  -- a review: one of your matches (kind 'match') or one pro play (kind 'play');
  -- source: what you watch it with ('none' | 'twitch' | 'file' | 'youtube'), offset: video seconds at the match start
  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL, match_id TEXT, puuid TEXT, play_id INTEGER,
    source TEXT NOT NULL DEFAULT 'none', source_ref TEXT, offset REAL,
    title TEXT, summary TEXT, status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX reviews_match ON reviews (match_id, puuid) WHERE kind = 'match';
  CREATE UNIQUE INDEX reviews_play ON reviews (play_id) WHERE kind = 'play';

  -- notes: on a round, on a duel (kill_key), at a video time (t), or all three
  CREATE TABLE notes (
    id INTEGER PRIMARY KEY,
    review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    round INTEGER, kill_key TEXT, t REAL,
    category TEXT NOT NULL, body TEXT NOT NULL, starred INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX notes_review ON notes (review_id);
  `,
  // 2: a rating per focus when a review is finished ({ "Positioning": 4, … }, 1–5)
  `
  ALTER TABLE reviews ADD COLUMN ratings TEXT;
  `,
  // 3: the Twitch profile picture of a pro (shown on their plays)
  `
  ALTER TABLE pros ADD COLUMN twitch_avatar TEXT;
  `,
  // 4: drawings on the round map, one per round of a match (seen from one player: you, or the pro of a play)
  `
  CREATE TABLE drawings (
    match_id TEXT NOT NULL, puuid TEXT NOT NULL, round INTEGER NOT NULL,
    strokes TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (match_id, puuid, round)
  );
  `,
  // 5: a note on several rounds ("3,5,8"; round holds the first of them). A note with no round is about the whole game.
  `
  ALTER TABLE notes ADD COLUMN rounds TEXT;
  `,
];

// swap(): the data folder moved; everyone keeps the same handle.
export function openDb(file = DB_FILE) {
  let cur = connect(file);
  return {
    prepare: (sql) => cur.prepare(sql),
    exec: (sql) => cur.exec(sql),
    close: () => cur.close(),
    swap(next) { const old = cur; cur = connect(next); try { old.close(); } catch {} },
  };
}

function connect(file) {
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  migrate(d, file);
  return d;
}

function migrate(d, file) {
  const version = d.prepare('PRAGMA user_version').get().user_version;
  if (version >= MIGRATIONS.length) return;
  if (version > 0 && file !== ':memory:' && fs.existsSync(file)) {
    try {
      const dir = path.join(path.dirname(file), 'backups');
      fs.mkdirSync(dir, { recursive: true });
      d.exec(`VACUUM INTO '${path.join(dir, `app-before-v${version + 1}-${Date.now()}.db`).replace(/'/g, "''")}'`);
    } catch (err) { console.warn('Backup before the database upgrade failed:', err.message); }
  }
  for (let v = version; v < MIGRATIONS.length; v++) {
    tx(d, () => { d.exec(MIGRATIONS[v]); d.exec(`PRAGMA user_version = ${v + 1}`); });
  }
}

export function tx(d, fn) {
  d.exec('BEGIN');
  try { const out = fn(); d.exec('COMMIT'); return out; }
  catch (err) { d.exec('ROLLBACK'); throw err; }
}

export function getKv(d, key, fallback = null) {
  const row = d.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}
export function setKv(d, key, value) {
  if (value === undefined || value === null) d.prepare('DELETE FROM kv WHERE key = ?').run(key);
  else d.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}
