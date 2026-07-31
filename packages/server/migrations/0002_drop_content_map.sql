-- Drop the WordPress content map.
--
-- The map existed to resolve a recorded URL path to a WordPress post ID. That
-- approach is dropped: reports link straight to the URL instead, which needs
-- nothing but the site's own origin. Everything below was in service of post-ID
-- matching and now has no consumer.
--
-- Analytics in Analytics Engine are untouched -- they were never stored here.

DROP TABLE IF EXISTS content_terms;
DROP TABLE IF EXISTS terms;
DROP TABLE IF EXISTS path_alias;
DROP TABLE IF EXISTS sync_state;
DROP TABLE IF EXISTS content;

-- Rebuild `sites` without the WordPress-specific columns.
--
-- A tracked site is now just an id, a name and an origin to build links from;
-- it does not have to be WordPress at all. SQLite cannot drop several columns
-- and rename another in one statement, so recreate and copy.
CREATE TABLE sites_new (
    site_id    TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    -- Origin used to turn a recorded path into a clickable link, e.g.
    -- https://gauravtiwari.org. No trailing slash.
    base_url   TEXT,
    timezone   TEXT NOT NULL DEFAULT 'UTC',
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO sites_new (site_id, label, base_url, timezone, enabled, created_at, updated_at)
SELECT site_id, label, wp_base_url, timezone, enabled, created_at, updated_at
  FROM sites;

DROP TABLE sites;
ALTER TABLE sites_new RENAME TO sites;
