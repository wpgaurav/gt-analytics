/**
 * WordPress -> D1 content sync.
 *
 * Pulls the public REST API of each managed site and mirrors it into `content`,
 * then projects a compact path -> post index into KV for the collector to read.
 *
 * Deliberately requires no plugin, no theme change and no credentials: every
 * endpoint used here is public on a stock WordPress install. That keeps
 * collection entirely Worker-side, so tracking a new site is one row in the
 * admin UI rather than a deploy on the WordPress box.
 */

import { isNonContentPath, normalizePath } from "./paths";
import type { Site } from "./sites";

/** WordPress objects we never want in the content map. */
const SKIPPED_TYPES = new Set([
    "attachment",
    "nav_menu_item",
    "wp_block",
    "wp_template",
    "wp_template_part",
    "wp_global_styles",
    "wp_navigation",
    "wp_font_family",
    "wp_font_face",
    "gblocks_styles",
    "gblocks_condition",
    "rm_content_editor",
    "rank_math_schema",
    "fct-dummy",
]);

const PAGE_SIZE = 100;

/** Guards a single sync run from wedging on a huge or misbehaving site. */
const MAX_PAGES_PER_TYPE = 60;

export interface TypeSyncResult {
    postType: string;
    restBase: string;
    seen: number;
    written: number;
    /** Objects with no addressable URL path, e.g. a ?type=slug permalink. */
    skipped: number;
    status: "ok" | "error";
    error?: string;
}

export interface SiteSyncResult {
    siteId: string;
    types: TypeSyncResult[];
    totalWritten: number;
    mapEntries: number;
    status: "ok" | "error";
    error?: string;
}

interface WpType {
    slug: string;
    rest_base: string;
    name?: string;
    visibility?: { public?: boolean };
}

interface WpItem {
    id: number;
    slug?: string;
    link?: string;
    type?: string;
    status?: string;
    date_gmt?: string;
    modified_gmt?: string;
    date?: string;
    modified?: string;
    author?: number;
    categories?: number[];
    tags?: number[];
    title?: { rendered?: string };
}

async function fetchJson<T>(url: string, timeoutMs = 20_000): Promise<T> {
    const response = await fetch(url, {
        headers: {
            accept: "application/json",
            // Identifies this traffic in the site's access logs, so a spike is
            // attributable rather than mysterious.
            "user-agent": "GT-Analytics-ContentSync/1.0 (+stats.gauravtiwari.org)",
        },
        signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} for ${url}`);
    }
    return (await response.json()) as T;
}

/**
 * Discovers the post types worth syncing. Falls back to the standard pair if
 * the types endpoint is unavailable, so a partially-locked-down site still
 * produces a useful map.
 */
export async function discoverPostTypes(baseUrl: string): Promise<WpType[]> {
    try {
        const types = await fetchJson<Record<string, WpType>>(
            `${baseUrl}/wp-json/wp/v2/types`,
        );
        return Object.values(types).filter(
            (t) => t?.rest_base && !SKIPPED_TYPES.has(t.slug),
        );
    } catch {
        return [
            { slug: "post", rest_base: "posts" },
            { slug: "page", rest_base: "pages" },
        ];
    }
}

/**
 * Syncs one post type, resuming from the stored cursor.
 *
 * Resumable via a `modified_after` cursor; paged by `id` for a stable order.
 * The cursor is the newest modified date written, so an interrupted run picks
 * up where it stopped instead of restarting.
 */
async function syncType(
    db: D1Database,
    site: Site,
    type: WpType,
): Promise<TypeSyncResult> {
    const result: TypeSyncResult = {
        postType: type.slug,
        restBase: type.rest_base,
        seen: 0,
        written: 0,
        skipped: 0,
        status: "ok",
    };

    const cursorRow = await db
        .prepare(
            `SELECT cursor_modified FROM sync_state WHERE site_id = ? AND post_type = ?`,
        )
        .bind(site.site_id, type.slug)
        .first<{ cursor_modified: string | null }>();

    // The cursor is fixed for the whole run and only advanced at the end.
    //
    // It must not move while paging: `modified_after` and `page` filter the
    // same result set, so advancing the cursor per page re-bases the window
    // and page N then skips the first N-1 pages of what remains. That silently
    // dropped roughly two thirds of every large post type.
    const startCursor = cursorRow?.cursor_modified ?? null;
    let maxModified = startCursor;
    const base = site.wp_base_url!;

    try {
        for (let page = 1; page <= MAX_PAGES_PER_TYPE; page++) {
            const params = new URLSearchParams({
                per_page: String(PAGE_SIZE),
                page: String(page),
                // Order by id, not modified.
                //
                // Offset pagination needs a *unique* sort key. Ordering by
                // `modified` puts many rows on the same second, so their
                // relative order is undefined and items drift across page
                // boundaries between requests -- some returned twice, some
                // never. That cost 3-5 objects per post type, silently.
                // `id` is unique and immutable, so page N is stable.
                //
                // Incremental syncing is unaffected: `modified_after` is a
                // filter, independent of the sort.
                orderby: "id",
                order: "asc",
                _fields:
                    "id,slug,link,type,status,date_gmt,modified_gmt,author,categories,tags,title",
            });
            if (startCursor) params.set("modified_after", startCursor);

            const url = `${base}/wp-json/wp/v2/${type.rest_base}?${params}`;

            let items: WpItem[];
            try {
                items = await fetchJson<WpItem[]>(url);
            } catch (error) {
                // Page 1 failing means the type is unreadable (private, or the
                // rest_base is wrong) -- report it. A later page failing after
                // a 400 usually just means we walked off the end.
                if (page === 1) throw error;
                break;
            }

            if (!Array.isArray(items) || items.length === 0) break;

            result.seen += items.length;
            const { written, skipped } = await writeItems(
                db,
                site,
                type.slug,
                items,
            );
            result.written += written;
            result.skipped += skipped;

            // Ordered ascending, so the last item of the last page carries the
            // newest modified date. Tracked here, written once the run ends.
            for (const item of items) {
                const modified = item.modified_gmt;
                if (modified && (!maxModified || modified > maxModified)) {
                    maxModified = modified;
                }
            }

            if (items.length < PAGE_SIZE) break;
        }

        await db
            .prepare(
                `INSERT INTO sync_state
                    (site_id, post_type, rest_base, cursor_modified, last_run_at, last_status, last_error, items_seen)
                 VALUES (?, ?, ?, ?, datetime('now'), 'ok', NULL, ?)
                 ON CONFLICT(site_id, post_type) DO UPDATE SET
                    rest_base       = excluded.rest_base,
                    cursor_modified = excluded.cursor_modified,
                    last_run_at     = excluded.last_run_at,
                    last_status     = 'ok',
                    last_error      = NULL,
                    items_seen      = sync_state.items_seen + excluded.items_seen`,
            )
            .bind(
                site.site_id,
                type.slug,
                type.rest_base,
                maxModified,
                result.seen,
            )
            .run();
    } catch (error) {
        result.status = "error";
        result.error = error instanceof Error ? error.message : String(error);

        await db
            .prepare(
                `INSERT INTO sync_state
                    (site_id, post_type, rest_base, last_run_at, last_status, last_error)
                 VALUES (?, ?, ?, datetime('now'), 'error', ?)
                 ON CONFLICT(site_id, post_type) DO UPDATE SET
                    last_run_at = excluded.last_run_at,
                    last_status = 'error',
                    last_error  = excluded.last_error`,
            )
            .bind(site.site_id, type.slug, type.rest_base, result.error)
            .run();
    }

    return result;
}

async function writeItems(
    db: D1Database,
    site: Site,
    postType: string,
    items: WpItem[],
): Promise<{ written: number; skipped: number }> {
    const statements: D1PreparedStatement[] = [];

    let skipped = 0;

    for (const item of items) {
        if (!item?.id) continue;

        const permalink = item.link ?? null;
        const path = normalizePath(permalink ?? `/${item.slug ?? ""}/`);

        // Some post types have no pretty permalink -- their `link` is a query
        // string, e.g. https://site/?testimonial=slug. Stripping the query
        // leaves "/" for every one of them, so without this they collide with
        // each other and evict whatever legitimately owns the site root.
        //
        // Such objects have no addressable path, so they cannot be attributed
        // by path regardless. Skipping is the honest outcome: their pageviews
        // are still counted, just not tied to a post.
        if (isNonContentPath(path)) {
            skipped++;
            continue;
        }
        const published = item.date_gmt ?? item.date ?? null;
        const year = published ? Number(published.slice(0, 4)) : null;
        const primaryTerm = item.categories?.length ? item.categories[0] : null;

        // If this post already exists under a different path, remember the old
        // one so hits recorded before a slug change still resolve.
        statements.push(
            db
                .prepare(
                    `INSERT OR REPLACE INTO path_alias (site_id, path, post_id)
                     SELECT site_id, path, post_id FROM content
                      WHERE site_id = ? AND post_id = ? AND path <> ?`,
                )
                .bind(site.site_id, item.id, path),
        );

        // A different object may already hold this path -- either the previous
        // occupant was deleted and the slug reused, or WordPress genuinely has
        // two objects claiming one URL (a post and a page with the same slug,
        // usually from an import or a slug edit; WordPress itself can only
        // serve one of them).
        //
        // The unique index on (site_id, path) forbids both, so the stale
        // holder is cleared first and the later writer wins. Post types are
        // discovered in a stable order, so this is deterministic run to run.
        // One URL maps to one object, which is what the collector needs.
        statements.push(
            db
                .prepare(
                    `DELETE FROM content WHERE site_id = ? AND path = ? AND post_id <> ?`,
                )
                .bind(site.site_id, path, item.id),
        );

        statements.push(
            db
                .prepare(
                    `INSERT INTO content
                        (site_id, post_id, post_type, slug, path, permalink, title, status,
                         published_at, modified_at, published_year, author_id, primary_term_id, synced_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                     ON CONFLICT(site_id, post_id) DO UPDATE SET
                        post_type       = excluded.post_type,
                        slug            = excluded.slug,
                        path            = excluded.path,
                        permalink       = excluded.permalink,
                        title           = excluded.title,
                        status          = excluded.status,
                        published_at    = excluded.published_at,
                        modified_at     = excluded.modified_at,
                        published_year  = excluded.published_year,
                        author_id       = excluded.author_id,
                        primary_term_id = excluded.primary_term_id,
                        synced_at       = datetime('now')`,
                )
                .bind(
                    site.site_id,
                    item.id,
                    item.type ?? postType,
                    item.slug ?? null,
                    path,
                    permalink,
                    decodeEntities(item.title?.rendered ?? ""),
                    item.status ?? "publish",
                    published,
                    item.modified_gmt ?? item.modified ?? null,
                    year,
                    item.author ?? null,
                    primaryTerm,
                ),
        );

        for (const [taxonomy, ids] of [
            ["category", item.categories],
            ["post_tag", item.tags],
        ] as const) {
            for (const termId of ids ?? []) {
                statements.push(
                    db
                        .prepare(
                            `INSERT OR IGNORE INTO content_terms
                                (site_id, post_id, taxonomy, term_id)
                             VALUES (?, ?, ?, ?)`,
                        )
                        .bind(site.site_id, item.id, taxonomy, termId),
                );
            }
        }
    }

    // D1 batches are capped; chunk so a large page cannot exceed the limit.
    for (let i = 0; i < statements.length; i += 100) {
        await db.batch(statements.slice(i, i + 100));
    }

    // Report what was actually mapped, not what was fetched, so a site whose
    // counts look short can be traced to unaddressable objects rather than to
    // a pagination fault.
    return { written: items.length - skipped, skipped };
}

/**
 * Rebuilds the KV projection the collector reads.
 *
 * Shape is `{ path: [postId, postType, termId, authorId, pubYear] }` -- arrays
 * rather than objects because at a few thousand entries the key repetition of
 * objects roughly doubles the payload the collector has to parse.
 */
export async function publishContentMap(
    db: D1Database,
    kv: KVNamespace,
    siteId: string,
): Promise<number> {
    const map: Record<string, [number, string, number, number, number]> = {};

    // Aliases first, so a live path always wins over a historical one.
    const aliases = await db
        .prepare(
            `SELECT a.path AS path, c.post_id, c.post_type, c.primary_term_id,
                    c.author_id, c.published_year
               FROM path_alias a
               JOIN content c ON c.site_id = a.site_id AND c.post_id = a.post_id
              WHERE a.site_id = ?`,
        )
        .bind(siteId)
        .all<Record<string, unknown>>();

    const live = await db
        .prepare(
            `SELECT path, post_id, post_type, primary_term_id, author_id, published_year
               FROM content WHERE site_id = ?`,
        )
        .bind(siteId)
        .all<Record<string, unknown>>();

    for (const row of [...(aliases.results ?? []), ...(live.results ?? [])]) {
        map[String(row.path)] = [
            Number(row.post_id) || 0,
            String(row.post_type ?? ""),
            Number(row.primary_term_id) || 0,
            Number(row.author_id) || 0,
            Number(row.published_year) || 0,
        ];
    }

    await kv.put(contentMapKey(siteId), JSON.stringify(map));
    return Object.keys(map).length;
}

export function contentMapKey(siteId: string): string {
    return `map:${siteId}`;
}

/** Syncs one site end to end and republishes its content map. */
export async function syncSite(
    db: D1Database,
    kv: KVNamespace,
    site: Site,
): Promise<SiteSyncResult> {
    const result: SiteSyncResult = {
        siteId: site.site_id,
        types: [],
        totalWritten: 0,
        mapEntries: 0,
        status: "ok",
    };

    if (!site.wp_base_url || !site.wp_sync_enabled) {
        result.status = "error";
        result.error = "WordPress sync is not enabled for this site.";
        return result;
    }

    try {
        const types = await discoverPostTypes(site.wp_base_url);
        for (const type of types) {
            const typeResult = await syncType(db, site, type);
            result.types.push(typeResult);
            result.totalWritten += typeResult.written;
            if (typeResult.status === "error") result.status = "error";
        }

        result.mapEntries = await publishContentMap(db, kv, site.site_id);
    } catch (error) {
        result.status = "error";
        result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
}

/** Syncs every enabled, WordPress-backed site. Used by the hourly cron. */
export async function syncAllSites(
    db: D1Database,
    kv: KVNamespace,
): Promise<SiteSyncResult[]> {
    const { results } = await db
        .prepare(
            `SELECT * FROM sites WHERE enabled = 1 AND wp_sync_enabled = 1
              ORDER BY site_id ASC`,
        )
        .all<Site>();

    const out: SiteSyncResult[] = [];
    for (const site of results ?? []) {
        out.push(await syncSite(db, kv, site));
    }
    return out;
}

/**
 * WordPress returns titles with HTML entities ("Gaurav&#8217;s"). Only the
 * handful that actually appear in titles are decoded -- this is display text,
 * not markup, and it is escaped again by React on the way out.
 */
function decodeEntities(input: string): string {
    if (!input) return "";
    return input
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
            String.fromCharCode(parseInt(code, 16)),
        )
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .trim();
}
