/**
 * The `sites` table: the properties this deployment tracks.
 *
 * A site is an id (what the tracker sends as `sid`), a display name, and an
 * origin used to turn a recorded path into a clickable link. Nothing more --
 * reports link to URLs directly, so no content mirroring is involved and a
 * tracked site does not have to be WordPress.
 *
 * Managed through the admin UI rather than configuration, so adding a site
 * never needs a redeploy.
 */

export interface Site {
    site_id: string;
    account_id: string;
    label: string;
    base_url: string | null;
    timezone: string;
    enabled: number;
    /**
     * First day this site's own collection is authoritative for. Days before
     * it are read from the archive even when retention would still cover them
     * -- see migration 0004. NULL for a site that has always collected here.
     */
    live_from: string | null;
    created_at: string;
    updated_at: string;
}

export interface SiteInput {
    site_id: string;
    label: string;
    base_url?: string | null;
    timezone?: string;
    enabled?: boolean;
}

export async function listSites(db: D1Database, accountId: string): Promise<Site[]> {
    const { results } = await db
        .prepare(`SELECT * FROM sites WHERE account_id = ? ORDER BY label COLLATE NOCASE ASC`)
        .bind(accountId)
        .all<Site>();
    return results ?? [];
}

export async function getSite(
    db: D1Database,
    accountId: string,
    siteId: string,
): Promise<Site | null> {
    return await db
        .prepare(`SELECT * FROM sites WHERE account_id = ? AND site_id = ?`)
        .bind(accountId, siteId)
        .first<Site>();
}

export async function siteIdExists(db: D1Database, siteId: string): Promise<boolean> {
    return Boolean(await db.prepare("SELECT 1 FROM sites WHERE site_id = ?").bind(siteId).first());
}

export async function accountOwnsSite(
    db: D1Database,
    accountId: string,
    siteId: string,
): Promise<boolean> {
    return Boolean(await db.prepare(
        "SELECT 1 FROM sites WHERE account_id = ? AND site_id = ?",
    ).bind(accountId, siteId).first());
}

/**
 * Returns site_id -> live_from for every site that has one.
 *
 * Read once per request rather than per card, so the router can be told where
 * a site's own data starts without every report making its own D1 call.
 */
export async function listSiteLiveFrom(
    db: D1Database,
): Promise<Record<string, string>> {
    const { results } = await db
        .prepare(
            `SELECT site_id, live_from FROM sites WHERE live_from IS NOT NULL`,
        )
        .all<{ site_id: string; live_from: string }>();

    return Object.fromEntries(
        (results ?? []).map((row) => [row.site_id, row.live_from]),
    );
}

/**
 * Returns site_id -> base_url for every site that has one, which is what the
 * dashboard needs to build outbound links.
 */
export async function listSiteUrls(
    db: D1Database,
    accountId: string,
): Promise<Record<string, string>> {
    const { results } = await db
        .prepare(`SELECT site_id, base_url FROM sites WHERE account_id = ? AND base_url IS NOT NULL`)
        .bind(accountId)
        .all<{ site_id: string; base_url: string }>();

    const urls: Record<string, string> = {};
    for (const row of results ?? []) {
        if (row.site_id && row.base_url) urls[row.site_id] = row.base_url;
    }
    return urls;
}

/**
 * Insert or update a site. `site_id` is the natural key and is what the
 * tracker sends, so changing it would orphan every recorded hit -- the admin
 * UI treats it as immutable after creation and this upsert preserves that by
 * keying on it.
 */
export async function upsertSite(
    db: D1Database,
    accountId: string,
    input: SiteInput,
): Promise<void> {
    await db
        .prepare(
            `INSERT INTO sites (site_id, account_id, label, base_url, timezone, enabled, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(site_id) DO UPDATE SET
                label      = excluded.label,
                base_url   = excluded.base_url,
                timezone   = excluded.timezone,
                enabled    = excluded.enabled,
                updated_at = datetime('now')
             WHERE sites.account_id = excluded.account_id`,
        )
        .bind(
            input.site_id,
            accountId,
            input.label,
            normalizeBaseUrl(input.base_url),
            input.timezone || "UTC",
            input.enabled === false ? 0 : 1,
        )
        .run();
}

/**
 * Removes a site. Recorded analytics are keyed by site id in Analytics Engine
 * and are untouched -- they simply stop resolving to a name and a link.
 */
export async function deleteSite(
    db: D1Database,
    accountId: string,
    siteId: string,
): Promise<void> {
    await db.prepare(`DELETE FROM sites WHERE account_id = ? AND site_id = ?`).bind(accountId, siteId).run();
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

    // The URL is optional: without one a site is still tracked, its report
    // rows just render as plain text instead of links.
    const base = (input.base_url || "").trim();
    if (base && !isValidHttpUrl(base)) {
        errors.base_url = "Must be a full URL, e.g. https://example.com";
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

/** Strips any trailing slash so paths can be appended predictably. */
export function normalizeBaseUrl(
    value: string | null | undefined,
): string | null {
    const trimmed = (value || "").trim();
    if (!trimmed) return null;
    return trimmed.replace(/\/+$/, "");
}
