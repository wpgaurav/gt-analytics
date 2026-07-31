/**
 * Saved views: a named query string you can jump back to.
 *
 * `site` is deliberately stripped from a preset's query. A preset answers
 * "show me AI traffic", not "show me AI traffic on that other site" -- it
 * should apply to whatever site is currently selected rather than moving you.
 */

export interface Preset {
    id: number;
    name: string;
    query: string;
    icon: string;
    position: number;
    built_in: number;
}

/** Parameters a preset is allowed to carry. Anything else is dropped. */
const ALLOWED_PARAMS = new Set([
    "interval",
    "path",
    "referrer",
    "referrerHost",
    "channel",
    "browserName",
    "browserVersion",
    "country",
    "deviceType",
    "deviceModel",
    "utmSource",
    "utmMedium",
    "utmCampaign",
    "utmTerm",
    "utmContent",
]);

export async function listPresets(db: D1Database): Promise<Preset[]> {
    const { results } = await db
        .prepare(`SELECT * FROM presets ORDER BY position ASC, id ASC`)
        .all<Preset>();
    return results ?? [];
}

export async function createPreset(
    db: D1Database,
    name: string,
    query: string,
    icon = "file-lines",
): Promise<void> {
    await db
        .prepare(
            `INSERT INTO presets (name, query, icon, position, built_in)
             VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 100) + 10 FROM presets), 0)`,
        )
        .bind(name.trim().slice(0, 60), query, icon)
        .run();
}

export async function deletePreset(
    db: D1Database,
    id: number,
): Promise<void> {
    await db.prepare(`DELETE FROM presets WHERE id = ?`).bind(id).run();
}

/**
 * Reduces a dashboard URL's search string to the parameters worth saving.
 *
 * Drops `site` (a preset should follow the current site) and anything not on
 * the allow-list, so a stray tracking parameter or a hand-edited URL cannot be
 * persisted into the sidebar.
 */
export function normalizePresetQuery(search: string): string {
    const input = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const output = new URLSearchParams();

    for (const key of [...ALLOWED_PARAMS]) {
        const value = input.get(key);
        if (value) output.set(key, value);
    }

    return output.toString();
}

/**
 * True when the current URL is showing this preset.
 *
 * Compares only the parameters the preset declares, so selecting a different
 * site or paginating does not un-highlight it.
 */
export function isPresetActive(preset: Preset, search: string): boolean {
    const current = new URLSearchParams(
        search.startsWith("?") ? search.slice(1) : search,
    );
    const wanted = new URLSearchParams(preset.query);

    for (const [key, value] of wanted) {
        if (current.get(key) !== value) return false;
    }

    // A preset that only sets an interval would otherwise match while a filter
    // is applied, highlighting two rows at once.
    for (const key of ALLOWED_PARAMS) {
        if (key === "interval") continue;
        if (current.get(key) && !wanted.get(key)) return false;
    }

    return true;
}

/** Builds the dashboard URL for a preset, keeping the current site. */
export function presetHref(preset: Preset, siteId: string | null): string {
    const params = new URLSearchParams(preset.query);
    if (siteId) params.set("site", siteId);
    return `/dashboard?${params.toString()}`;
}
