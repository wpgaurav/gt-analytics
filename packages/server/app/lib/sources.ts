/**
 * Human names for referrer hosts.
 *
 * "ChatGPT" reads better than "chatgpt.com", and more importantly it lets one
 * brand's several hostnames collapse into a single row -- chat.openai.com and
 * chatgpt.com are the same source to anyone reading a report.
 *
 * Unknown hosts fall through to the hostname itself, which is a perfectly good
 * label; this list only needs to cover sources common enough that seeing a
 * bare domain would be a small annoyance.
 */

const SOURCE_NAMES: Record<string, string> = {
    // AI assistants
    "chatgpt.com": "ChatGPT",
    "chat.openai.com": "ChatGPT",
    "openai.com": "ChatGPT",
    "perplexity.ai": "Perplexity",
    "claude.ai": "Claude",
    "gemini.google.com": "Gemini",
    "bard.google.com": "Gemini",
    "copilot.microsoft.com": "Copilot",
    "you.com": "You.com",
    "phind.com": "Phind",
    "poe.com": "Poe",
    "grok.com": "Grok",
    "deepseek.com": "DeepSeek",
    "kagi.com": "Kagi",

    // Search
    "google.com": "Google",
    "bing.com": "Bing",
    "duckduckgo.com": "DuckDuckGo",
    "search.yahoo.com": "Yahoo",
    "yahoo.com": "Yahoo",
    "yandex.com": "Yandex",
    "baidu.com": "Baidu",
    "ecosia.org": "Ecosia",
    "search.brave.com": "Brave Search",
    "startpage.com": "Startpage",
    "qwant.com": "Qwant",
    "naver.com": "Naver",

    // Social
    "facebook.com": "Facebook",
    "m.facebook.com": "Facebook",
    "l.facebook.com": "Facebook",
    "instagram.com": "Instagram",
    "l.instagram.com": "Instagram",
    "twitter.com": "X (Twitter)",
    "x.com": "X (Twitter)",
    "t.co": "X (Twitter)",
    "linkedin.com": "LinkedIn",
    "lnkd.in": "LinkedIn",
    "reddit.com": "Reddit",
    "out.reddit.com": "Reddit",
    "pinterest.com": "Pinterest",
    "youtube.com": "YouTube",
    "youtu.be": "YouTube",
    "tiktok.com": "TikTok",
    "t.me": "Telegram",
    "telegram.org": "Telegram",
    "threads.net": "Threads",
    "threads.com": "Threads",
    "bsky.app": "Bluesky",
    "quora.com": "Quora",
    "medium.com": "Medium",
    "substack.com": "Substack",
    "news.ycombinator.com": "Hacker News",
    "discord.com": "Discord",
    "whatsapp.com": "WhatsApp",

    // Mail
    "mail.google.com": "Gmail",
    "outlook.live.com": "Outlook",
    "outlook.office.com": "Outlook",
    "outlook.office365.com": "Outlook",
    "mail.yahoo.com": "Yahoo Mail",
    "mail.proton.me": "Proton Mail",

    // Android app referrers
    "com.google.android.gm": "Gmail (app)",
    "com.google.android.googlequicksearchbox": "Google (app)",
    "com.linkedin.android": "LinkedIn (app)",
    "com.twitter.android": "X (app)",
    "org.telegram.messenger": "Telegram (app)",
    "com.whatsapp": "WhatsApp (app)",
};

/**
 * Display name for a referrer host.
 *
 * Handles country variants of the big search engines (google.co.in,
 * google.com.au) so they do not each get their own row.
 */
export function sourceName(host: string): string {
    if (!host) return "Direct";

    const exact = SOURCE_NAMES[host];
    if (exact) return exact;

    // google.co.in, google.com.au, google.de ...
    const searchVariant = host.match(
        /^(google|bing|yahoo|yandex|duckduckgo|ecosia|qwant)\./,
    );
    if (searchVariant) {
        return SOURCE_NAMES[`${searchVariant[1]}.com`] || capitalise(searchVariant[1]);
    }

    // A subdomain of something known, e.g. de.linkedin.com.
    const parts = host.split(".");
    for (let i = 1; i < parts.length - 1; i++) {
        const candidate = parts.slice(i).join(".");
        if (SOURCE_NAMES[candidate]) return SOURCE_NAMES[candidate];
    }

    return host;
}

function capitalise(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Shortens a URL for display: drops the scheme and any trailing slash. */
export function displayUrl(url: string): string {
    if (!url) return "";
    return url.replace(/^https?:\/\//, "").replace(/\/$/, "") || url;
}
