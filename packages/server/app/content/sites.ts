/**
 * The `sites` table: the set of properties this deployment tracks.
 *
 * This is the only hand-authored table in the content map, and it is managed
 * through the admin UI rather than configuration, so adding a site never needs
 * a redeploy.
 */

export interface Site {
    site_id: string;
    label: string;
    wp_base_url: string | null;
    wp_admin_url: string | null;
    timezone: string;
    enabled: number;
    wp_sync_enabled: number;
    created_at: string;
    updated_at: string;
}

export interface SiteInput {
    site_id: string;
    label: string;
    wp_base_url?: string | null;
    wp_admin_url?: string | null;
    timezone?: string;
    enabled?: boolean;
    wp_sync_enabled?: boolean;
}

export interface SiteSyncSummary {
    site_id: string;
    content_count: number;
    last_run_at: string | null;
    last_status: string | null;
    last_error: string | null;
    types_tracked: number;
}

export async function listSites(db: D1Database): Promise<Site[]> {
    const { results } = await db
        .prepare(`SELECT * FROM sites ORDER BY label COLLATE NOCASE ASC`)
        .all<Site>();
    return results ?? [];
}

export async function getSite(
    db: D1Database,
    siteId: string,
): Promise<Site | null> {
    return await db
        .prepare(`SELECT * FROM sites WHERE site_id = ?`)
        .bind(siteId)
        .first<Site>();
}

/**
 * Insert or update a site. `site_id` is the natural key and is what the
 * tracker sends, so changing it would orphan every recorded hit -- the admin
 * UI treats it as immutable after creation and this upsert preserves that by
 * keying on it.
 */
export async function upsertSite(
    db: D1Database,
    input: SiteInput,
): Promise<void> {
    await db
        .prepare(
            `INSERT INTO sites
                (site_id, label, wp_base_url, wp_admin_url, timezone, enabled, wp_sync_enabled, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(site_id) DO UPDATE SET
                label           = excluded.label,
                wp_base_url     = excluded.wp_base_url,
                wp_admin_url    = excluded.wp_admin_url,
                timezone        = excluded.timezone,
                enabled         = excluded.enabled,
                wp_sync_enabled = excluded.wp_sync_enabled,
                updated_at      = datetime('now')`,
        )
        .bind(
            input.site_id,
            input.label,
            normalizeBaseUrl(input.wp_base_url),
            normalizeBaseUrl(input.wp_admin_url),
            input.timezone || "UTC",
            input.enabled === false ? 0 : 1,
            input.wp_sync_enabled === false ? 0 : 1,
        )
        .run();
}

/**
 * Removes a site and everything derived from it. The recorded analytics in
 * Analytics Engine are untouched -- they are keyed by site id and will simply
 * stop resolving to posts.
 */
export async function deleteSite(
    db: D1Database,
    siteId: string,
): Promise<void> {
    await db.batch([
        db.prepare(`DELETE FROM content WHERE site_id = ?`).bind(siteId),
        db.prepare(`DELETE FROM content_terms WHERE site_id = ?`).bind(siteId),
        db.prepare(`DELETE FROM terms WHERE site_id = ?`).bind(siteId),
        db.prepare(`DELETE FROM path_alias WHERE site_id = ?`).bind(siteId),
        db.prepare(`DELETE FROM sync_state WHERE site_id = ?`).bind(siteId),
        db.prepare(`DELETE FROM sites WHERE site_id = ?`).bind(siteId),
    ]);
}

/**
 * Per-site sync health for the admin list: how much content is mapped, when it
 * last ran, and whether anything failed.
 */
export async function listSyncSummaries(
    db: D1Database,
): Promise<Record<string, SiteSyncSummary>> {
    const { results } = await db
        .prepare(
            `SELECT s.site_id                                    AS site_id,
                    (SELECT COUNT(*) FROM content c
                      WHERE c.site_id = s.site_id)               AS content_count,
                    MAX(ss.last_run_at)                          AS last_run_at,
                    COUNT(ss.post_type)                          AS types_tracked,
                    MAX(CASE WHEN ss.last_status = 'error'
                             THEN ss.last_status END)            AS last_status,
                    MAX(CASE WHEN ss.last_status = 'error'
                             THEN ss.last_error END)             AS last_error
               FROM sites s
               LEFT JOIN sync_state ss ON ss.site_id = s.site_id
              GROUP BY s.site_id`,
        )
        .all<SiteSyncSummary>();

    const byId: Record<string, SiteSyncSummary> = {};
    for (const row of results ?? []) {
        byId[row.site_id] = row;
    }
    return byId;
}

export async function listSyncState(db: D1Database, siteId: string) {
    const { results } = await db
        .prepare(
            `SELECT post_type, rest_base, cursor_modified, last_run_at,
                    last_status, last_error, items_seen
               FROM sync_state WHERE site_id = ?
              ORDER BY post_type ASC`,
        )
        .bind(siteId)
        .all();
    return results ?? [];
}

/**
 * Validates admin form input. Returns a map of field name to message; an empty
 * object means the input is usable.
 */
export function validateSiteInput(
    input: Partial<SiteInput>,
): Record<string, string> {
    const errors: Record<string, string> = {};

    const siteId = (input.site_id || "").trim();
    if (!siteId) {
        errors.site_id = "Required. This must match the tracker's data-site-id.";
    } else if (siteId.length > 64) {
        errors.site_id = "Must be 64 characters or fewer.";
    } else if (!/^[a-zA-Z0-9._-]+$/.test(siteId)) {
        errors.site_id =
            "Use letters, numbers, dots, dashes and underscores only.";
    }

    if (!(input.label || "").trim()) {
        errors.label = "Required.";
    }

    // A WordPress base URL is only required when WP syncing is on -- a plain
    // site can be tracked without one.
    const base = (input.wp_base_url || "").trim();
    if (input.wp_sync_enabled !== false && !base) {
        errors.wp_base_url =
            "Required when WordPress sync is enabled, or turn sync off.";
    }
    if (base && !isValidHttpUrl(base)) {
        errors.wp_base_url = "Must be a full URL, e.g. https://example.com";
    }

    const admin = (input.wp_admin_url || "").trim();
    if (admin && !isValidHttpUrl(admin)) {
        errors.wp_admin_url = "Must be a full URL, or left blank.";
    }

    return errors;
}

function isValidHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

/** Strips any trailing slash so URLs can be concatenated predictably. */
export function normalizeBaseUrl(
    value: string | null | undefined,
): string | null {
    const trimmed = (value || "").trim();
    if (!trimmed) return null;
    return trimmed.replace(/\/+$/, "");
}

/** Where a post's wp-admin edit screen lives, for dashboard deep links. */
export function adminEditUrl(site: Site, postId: number): string | null {
    const base = site.wp_admin_url || (site.wp_base_url ? `${site.wp_base_url}/wp-admin` : null);
    if (!base) return null;
    return `${base}/post.php?post=${postId}&action=edit`;
}
