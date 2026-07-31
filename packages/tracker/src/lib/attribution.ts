/**
 * First-touch attribution, remembered for the length of a browser session.
 *
 * Without this, only a session's landing page carries a referrer: every
 * subsequent pageview reports an internal referrer, which the collector
 * discards, so a visit that arrived from a search engine is credited to that
 * engine once and the rest of the session looks like direct traffic.
 *
 * sessionStorage is deliberate. It is per-tab and cleared when the tab closes,
 * so this is not a cross-session identifier and adds nothing that could track
 * someone between visits.
 */

const REFERRER_KEY = "_cs_ref";
const CLICKID_KEY = "_cs_cid";

/** Ad-platform click IDs, in the order they are checked. */
const CLICK_ID_PARAMS = [
    "gclid",
    "gbraid",
    "wbraid",
    "dclid",
    "msclkid",
    "fbclid",
    "igshid",
    "ttclid",
    "twclid",
    "li_fat_id",
    "epik",
    "rdt_cid",
    "irclickid",
    "yclid",
];

function safeSession(): Storage | null {
    try {
        // Access can throw outright in some privacy modes and sandboxes.
        const storage = window.sessionStorage;
        const probe = "__cs_probe";
        storage.setItem(probe, "1");
        storage.removeItem(probe);
        return storage;
    } catch {
        return null;
    }
}

/**
 * Records the session's originating referrer the first time it is seen and
 * returns it on every later call.
 *
 * `currentReferrer` should already have had self-referrals removed, so an
 * internal navigation never overwrites the real source.
 */
export function rememberSessionReferrer(currentReferrer: string): string {
    const storage = safeSession();
    if (!storage) return currentReferrer;

    const stored = storage.getItem(REFERRER_KEY);
    if (stored !== null) {
        // Already attributed. A later external referrer mid-session is a
        // genuine re-entry, but first-touch is the more useful default and
        // the immediate referrer is still sent separately as `r`.
        return stored;
    }

    storage.setItem(REFERRER_KEY, currentReferrer);
    return currentReferrer;
}

/**
 * Returns the click ID parameter present on the landing URL, remembering it
 * for the session so later pageviews stay attributed to the ad click.
 *
 * Only the parameter *name* is kept. The value identifies one individual
 * click, and storing it would turn analytics into an identifier.
 */
export function getSessionClickId(search: string): string {
    const storage = safeSession();

    let found = "";
    try {
        const params = new URLSearchParams(search || "");
        for (const name of CLICK_ID_PARAMS) {
            if (params.get(name)) {
                found = name;
                break;
            }
        }
    } catch {
        found = "";
    }

    if (!storage) return found;

    if (found) {
        storage.setItem(CLICKID_KEY, found);
        return found;
    }

    return storage.getItem(CLICKID_KEY) || "";
}
