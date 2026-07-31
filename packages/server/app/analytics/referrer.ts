/**
 * Referral attribution.
 *
 * Counterscale stored the raw referrer string and nothing else, which loses a
 * lot: `https://www.google.com/` and `https://google.com/` split into separate
 * rows, an internal navigation reports no referrer at all, and traffic whose
 * referrer was stripped (most paid and app traffic) is indistinguishable from
 * someone typing the URL.
 *
 * This derives three extra columns at collection time -- the normalised source
 * host, a channel, and which click ID was present. Doing it server-side rather
 * than in the tracker means the classification can be corrected without
 * redeploying a script to every site.
 */

/** Query parameters ad platforms append, and the source each implies. */
const CLICK_IDS: Record<string, string> = {
    gclid: "google",
    gbraid: "google",
    wbraid: "google",
    dclid: "google",
    msclkid: "bing",
    fbclid: "facebook",
    igshid: "instagram",
    ttclid: "tiktok",
    twclid: "twitter",
    li_fat_id: "linkedin",
    epik: "pinterest",
    rdt_cid: "reddit",
    irclickid: "impact",
    yclid: "yandex",
};

const SEARCH_HOSTS = [
    "google.",
    "bing.com",
    "duckduckgo.com",
    "search.yahoo.",
    "yahoo.com",
    "yandex.",
    "baidu.com",
    "ecosia.org",
    "search.brave.com",
    "startpage.com",
    "qwant.com",
    "naver.com",
    "seznam.cz",
    "ask.com",
    "lite.duckduckgo.com",
];

/**
 * Assistants and answer engines. Kept separate from search because their
 * traffic behaves differently and because knowing whether an AI surface is
 * sending anyone is the whole point of tracking it.
 */
const AI_HOSTS = [
    "chatgpt.com",
    "chat.openai.com",
    "openai.com",
    "perplexity.ai",
    "claude.ai",
    "gemini.google.com",
    "bard.google.com",
    "copilot.microsoft.com",
    "you.com",
    "phind.com",
    "poe.com",
    "mistral.ai",
    "grok.com",
    "deepseek.com",
    "kagi.com",
];

const SOCIAL_HOSTS = [
    "facebook.com",
    "fb.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "t.co",
    "linkedin.com",
    "lnkd.in",
    "reddit.com",
    "pinterest.",
    "youtube.com",
    "youtu.be",
    "tiktok.com",
    "whatsapp.com",
    "telegram.org",
    "t.me",
    "threads.net",
    "threads.com",
    "mastodon.",
    "bsky.app",
    "quora.com",
    "medium.com",
    "substack.com",
    "news.ycombinator.com",
    "discord.com",
    "slack.com",
];

const EMAIL_HOSTS = [
    "mail.google.com",
    "outlook.live.com",
    "outlook.office.com",
    "outlook.office365.com",
    "mail.yahoo.com",
    "mail.proton.me",
    "superhuman.com",
    "hey.com",
    "mail.zoho.com",
];

export type Channel =
    | "direct"
    | "search"
    | "ai"
    | "social"
    | "email"
    | "paid"
    | "referral"
    | "internal";

/**
 * Extracts a comparable hostname from a referrer.
 *
 * Returns "" when the referrer is absent, unparseable, or the site itself.
 * `www.` is stripped so a source does not split across two rows.
 */
export function referrerHost(
    referrer: string | null | undefined,
    selfHost?: string | null,
): string {
    const raw = (referrer || "").trim();
    if (!raw) return "";

    // Android surfaces attribute with android-app://<package>, which is not a
    // URL a browser would produce but is a real and useful source.
    const androidApp = raw.match(/^android-app:\/\/([^/]+)/i);
    if (androidApp) return androidApp[1].toLowerCase();

    let host: string;
    try {
        host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
    } catch {
        return "";
    }

    host = host.toLowerCase().replace(/^www\./, "");
    if (!host) return "";

    // Self-referral. Upstream used `referrer.indexOf(hostname) >= 0`, a
    // substring test that both misses subdomains and false-positives on any
    // host that merely contains the site's name -- "notgauravtiwari.org.uk"
    // would have been silently discarded as internal traffic.
    const self = normalizeHost(selfHost);
    if (self && (host === self || host.endsWith(`.${self}`))) return "";

    return host;
}

function normalizeHost(value: string | null | undefined): string {
    return (value || "").trim().toLowerCase().replace(/^www\./, "");
}

/** True when the referrer is the site itself. */
export function isInternalReferrer(
    referrer: string | null | undefined,
    selfHost?: string | null,
): boolean {
    const raw = (referrer || "").trim();
    if (!raw) return false;
    return referrerHost(raw, selfHost) === "" && !/^android-app:/i.test(raw);
}

/** Returns the click ID present on a landing URL, if any. */
export function detectClickId(
    params: URLSearchParams | Record<string, string> | null | undefined,
): { name: string; source: string } | null {
    if (!params) return null;

    const get = (key: string) =>
        params instanceof URLSearchParams ? params.get(key) : params[key];

    for (const [name, source] of Object.entries(CLICK_IDS)) {
        const value = get(name);
        if (value) return { name, source };
    }
    return null;
}

export interface ClassifyInput {
    referrer?: string | null;
    /** The site's own hostname, used to recognise internal navigation. */
    selfHost?: string | null;
    utmMedium?: string | null;
    utmSource?: string | null;
    clickId?: string | null;
}

/**
 * Buckets a hit into a marketing channel.
 *
 * Order matters. An explicit utm_medium is the site owner's own declaration
 * and outranks inference; a click ID means paid regardless of what the
 * referrer says; and the referrer is only consulted last.
 */
export function classifyChannel({
    referrer,
    selfHost,
    utmMedium,
    utmSource,
    clickId,
}: ClassifyInput): Channel {
    const medium = (utmMedium || "").toLowerCase();

    if (medium) {
        if (/cpc|ppc|paid|cpm|cpv|display|retargeting/.test(medium))
            return "paid";
        if (/email|newsletter/.test(medium)) return "email";
        if (/social/.test(medium)) return "social";
        if (/organic/.test(medium)) return "search";
        if (/affiliate/.test(medium)) return "referral";
    }

    // A click ID only ever comes from an ad click.
    if (clickId) return "paid";

    const raw = (referrer || "").trim();
    const host = referrerHost(raw, selfHost);

    if (!host) {
        // Distinguish "came from our own pages" from "arrived with nothing",
        // so internal navigation does not inflate direct traffic.
        return raw ? "internal" : "direct";
    }

    // Order is load-bearing. The AI and email lists hold specific hostnames
    // that sit under a search engine's domain -- gemini.google.com and
    // mail.google.com both match the broad "google." search pattern -- so the
    // narrow lists have to be consulted first or they are miscounted.
    if (matchesHost(host, AI_HOSTS)) return "ai";
    if (matchesHost(host, EMAIL_HOSTS)) return "email";
    if (matchesHost(host, SEARCH_HOSTS)) return "search";
    if (matchesHost(host, SOCIAL_HOSTS)) return "social";

    // utm_source can still name a channel when the referrer is generic.
    const source = (utmSource || "").toLowerCase();
    if (source && matchesHost(source, AI_HOSTS)) return "ai";
    if (source && matchesHost(source, SOCIAL_HOSTS)) return "social";

    return "referral";
}

function matchesHost(host: string, list: string[]): boolean {
    return list.some((entry) =>
        entry.endsWith(".")
            ? host.startsWith(entry) || host.includes(`.${entry}`)
            : host === entry || host.endsWith(`.${entry}`),
    );
}
