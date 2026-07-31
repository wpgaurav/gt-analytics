-- Saved views.
--
-- A preset is a named query string -- interval plus whatever filters were
-- active -- so a question you ask often ("where is AI traffic landing?")
-- becomes one click instead of three.
--
-- The query is stored as the raw search string rather than parsed columns.
-- Filters change over time (channel and referrerHost were added after the
-- first release), and a schema that enumerated them would need a migration
-- every time one more became filterable.

CREATE TABLE IF NOT EXISTS presets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    -- URL search string without the leading "?", e.g. "interval=7d&channel=ai".
    -- Deliberately excludes `site`, so a preset applies to whichever site is
    -- being looked at rather than yanking you to another one.
    query      TEXT NOT NULL,
    -- Icon name from app/components/icon-paths.ts.
    icon       TEXT NOT NULL DEFAULT 'file-lines',
    position   INTEGER NOT NULL DEFAULT 100,
    -- Seeded rows are marked so they can be told apart from a user's own.
    built_in   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_presets_position ON presets (position, id);

-- Defaults, covering the questions worth a shortcut on day one: the channels
-- that behave differently enough to be worth isolating, and the two time
-- ranges that get used most.
INSERT INTO presets (name, query, icon, position, built_in) VALUES
    ('Today',          'interval=today',        'gauge-high',        10, 1),
    ('Last 7 days',    'interval=7d',           'gauge-high',        20, 1),
    ('AI assistants',  'interval=30d&channel=ai',        'robot',             30, 1),
    ('Search',         'interval=30d&channel=search',    'magnifying-glass',  40, 1),
    ('Social',         'interval=30d&channel=social',    'share-nodes',       50, 1),
    ('Paid',           'interval=30d&channel=paid',      'rectangle-ad',      60, 1),
    ('Referrals',      'interval=30d&channel=referral',  'link',              70, 1),
    ('Direct',         'interval=30d&channel=direct',    'house',             80, 1);
