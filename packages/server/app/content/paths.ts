/**
 * Path normalisation.
 *
 * The collector records whatever the tracker sends as `?p=`, while the content
 * map is built from WordPress's REST `link` field. Both are normalised through
 * here so a lookup is a plain string equality check, which is what lets the
 * hot path be an in-memory map rather than a query.
 *
 * Deliberately conservative: this only removes differences that are never
 * meaningful in a WordPress permalink (origin, case, duplicate or missing
 * trailing slash, percent-encoding, query string, fragment). It does not strip
 * path segments or attempt to guess structure -- permalinks vary per site and
 * per post type, and guessing is how a mapping silently attaches views to the
 * wrong post.
 */

/**
 * Normalises a URL or path to the canonical form used as the content map key.
 *
 * Always returns a string beginning and ending with "/". The site root is "/".
 */
export function normalizePath(input: string | null | undefined): string {
    if (!input) return "/";

    let path = input.trim();
    if (!path) return "/";

    // Accept a full URL or a bare path.
    if (/^https?:\/\//i.test(path)) {
        try {
            path = new URL(path).pathname;
        } catch {
            // Malformed URL: fall through and treat it as a path.
        }
    }

    // Drop query and fragment -- the same post is the same post regardless of
    // utm parameters, and those are recorded in their own columns anyway.
    path = path.split("#")[0].split("?")[0];

    // Percent-decoding makes non-Latin slugs (Hindi posts, for one) compare
    // equal whether or not the browser encoded them.
    try {
        path = decodeURIComponent(path);
    } catch {
        // Leave malformed escape sequences as-is rather than throwing.
    }

    path = path.toLowerCase();

    // Collapse repeated slashes, then enforce exactly one at each end.
    path = path.replace(/\/{2,}/g, "/");
    if (!path.startsWith("/")) path = "/" + path;
    if (!path.endsWith("/")) path = path + "/";

    return path;
}

/**
 * True when a path is one WordPress would never map to a single object, so the
 * sync and the collector can skip trying. Feed lookups still record pageviews;
 * they just carry no post ID.
 */
export function isNonContentPath(path: string): boolean {
    return (
        path === "/" ||
        path.startsWith("/wp-admin/") ||
        path.startsWith("/wp-json/") ||
        path.startsWith("/wp-content/") ||
        path.startsWith("/feed/") ||
        path.endsWith("/feed/")
    );
}
