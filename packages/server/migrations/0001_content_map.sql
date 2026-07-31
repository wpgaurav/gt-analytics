-- GT Analytics content map.
--
-- Mirrors the public WordPress REST API of each managed site so a URL path
-- recorded by the collector can be resolved to a real post ID, and so the
-- dashboard can report on content (type, author, taxonomy, publish date)
-- rather than bare paths.
--
-- Nothing here is authored by hand except `sites`, which is managed through
-- the admin UI. Everything else is a projection of WordPress and is safe to
-- delete and rebuild from a full sync.

-- ---------------------------------------------------------------------------
-- sites: the properties this deployment tracks.
-- `site_id` is the value the tracker sends as `sid` and the collector writes
-- to blob8, so it must match the tracking snippet exactly.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sites (
    site_id        TEXT PRIMARY KEY,
    label          TEXT NOT NULL,
    wp_base_url    TEXT,
    timezone       TEXT NOT NULL DEFAULT 'UTC',
    -- 0 disables collection-time enrichment and scheduled syncing without
    -- losing the row or its content map.
    enabled        INTEGER NOT NULL DEFAULT 1,
    -- 0 for non-WordPress properties, which still get plain path analytics.
    wp_sync_enabled INTEGER NOT NULL DEFAULT 1,
    -- Admin base for building edit links; defaults to wp_base_url + /wp-admin.
    wp_admin_url   TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- content: one row per WordPress object, across every post type.
-- `path` is derived from the REST `link` field and normalised, never guessed
-- from the slug -- permalink structures vary per site and per post type
-- (/go/{slug}, /course/{a}/{b}/, /deal/{slug}, bare /{slug}).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content (
    site_id        TEXT NOT NULL,
    post_id        INTEGER NOT NULL,
    post_type      TEXT NOT NULL,
    slug           TEXT,
    path           TEXT NOT NULL,
    permalink      TEXT,
    title          TEXT,
    -- 'publish', 'draft', ... plus 'gone' for objects that disappeared from
    -- WordPress. Kept rather than deleted so historical hits still resolve.
    status         TEXT NOT NULL DEFAULT 'publish',
    published_at   TEXT,
    modified_at    TEXT,
    published_year INTEGER,
    author_id      INTEGER,
    author_name    TEXT,
    primary_term_id INTEGER,
    synced_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (site_id, post_id)
);

-- The collector's lookup, and the dashboard's join key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_site_path ON content (site_id, path);
CREATE INDEX IF NOT EXISTS idx_content_site_type ON content (site_id, post_type);
CREATE INDEX IF NOT EXISTS idx_content_site_year ON content (site_id, published_year);
CREATE INDEX IF NOT EXISTS idx_content_site_author ON content (site_id, author_id);

-- ---------------------------------------------------------------------------
-- content_terms: taxonomy membership, for category/tag rollups.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_terms (
    site_id   TEXT NOT NULL,
    post_id   INTEGER NOT NULL,
    taxonomy  TEXT NOT NULL,
    term_id   INTEGER NOT NULL,
    term_name TEXT,
    PRIMARY KEY (site_id, post_id, taxonomy, term_id)
);

CREATE INDEX IF NOT EXISTS idx_terms_site_tax_term ON content_terms (site_id, taxonomy, term_id);

-- ---------------------------------------------------------------------------
-- terms: term id -> name, so rollups can be labelled without a join per row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS terms (
    site_id   TEXT NOT NULL,
    taxonomy  TEXT NOT NULL,
    term_id   INTEGER NOT NULL,
    name      TEXT,
    slug      TEXT,
    PRIMARY KEY (site_id, taxonomy, term_id)
);

-- ---------------------------------------------------------------------------
-- path_alias: previous paths that should still resolve to a post.
-- Populated when a sync sees a post's path change, so hits recorded under the
-- old URL (and any redirect traffic) keep resolving.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS path_alias (
    site_id  TEXT NOT NULL,
    path     TEXT NOT NULL,
    post_id  INTEGER NOT NULL,
    noted_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (site_id, path)
);

-- ---------------------------------------------------------------------------
-- sync_state: per site and post type, where the incremental cursor sits.
-- `cursor_modified` is the WordPress `modified_gmt` of the newest object
-- pulled, fed back as `modified_after` on the next run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_state (
    site_id         TEXT NOT NULL,
    post_type       TEXT NOT NULL,
    rest_base       TEXT,
    cursor_modified TEXT,
    last_run_at     TEXT,
    last_status     TEXT,
    last_error      TEXT,
    items_seen      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (site_id, post_type)
);
