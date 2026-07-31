/**
 * Remembers which site was last looked at.
 *
 * Without this the dashboard redirects to whichever site had the most hits,
 * which is rarely the one you were working on and changes under you as traffic
 * moves. The preference is a plain cookie: it is a UI convenience, not a
 * credential, so it is readable by the page that sets it.
 */

const COOKIE = "gta_site";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Reads the remembered site, or null.
 *
 * Tolerates a request without headers. A missing preference has to mean "no
 * preference" rather than an exception -- this runs inside the dashboard
 * loader, and throwing here would replace the whole report with an error page
 * over a cosmetic convenience.
 */
export function readPreferredSite(request: Request): string | null {
    const header = request?.headers?.get?.("Cookie");
    if (!header) return null;

    for (const part of header.split(";")) {
        const [name, ...rest] = part.trim().split("=");
        if (name === COOKIE) {
            const value = decodeURIComponent(rest.join("="));
            return value || null;
        }
    }
    return null;
}

/**
 * Picks the site to show when the URL does not name one.
 *
 * Falls back rather than trusting the cookie blindly: a site can be renamed or
 * removed, and stranding someone on a dead site id with an empty dashboard is
 * worse than ignoring the preference.
 */
export function choosePreferredSite(
    request: Request,
    knownSites: string[],
    fallback: string,
): string {
    const preferred = readPreferredSite(request);
    if (preferred && knownSites.includes(preferred)) {
        return preferred;
    }
    return fallback;
}

export function siteCookie(siteId: string): string {
    const attributes = [
        `${COOKIE}=${encodeURIComponent(siteId)}`,
        "Path=/",
        `Max-Age=${MAX_AGE_SECONDS}`,
        "SameSite=Lax",
    ];
    return attributes.join("; ");
}

/** The client-side form, for writing the preference on selection. */
export const SITE_COOKIE_NAME = COOKIE;
