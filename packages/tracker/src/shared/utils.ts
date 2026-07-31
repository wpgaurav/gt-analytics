import type { HostnameAndPath, UtmParams } from "./types";

export function isLocalhostAddress(hostname: string): boolean {
    return /^localhost$|^127(?:\.[0-9]+){0,2}\.[0-9]+$|^(?:0*:)*?:?0*1$/.test(
        hostname,
    );
}

export function getHostnameAndPath(
    url: string,
    useBrowserDOM = false,
): HostnameAndPath {
    if (useBrowserDOM && typeof document !== "undefined") {
        // Browser implementation using DOM
        const a = document.createElement("a");
        a.href = url;
        const hostname = a.protocol + "//" + a.hostname;
        const path = a.pathname;
        return { hostname, path };
    } else {
        // Node.js/server implementation using URL constructor
        const urlObj = new URL(url);
        const hostname = urlObj.protocol + "//" + urlObj.hostname;
        const path = urlObj.pathname;
        return { hostname, path };
    }
}

export function getReferrer(hostname: string, referrer: string): string {
    if (!referrer) {
        return "";
    }

    // Compare hostnames, not substrings.
    //
    // The old test was `referrer.indexOf(hostname) >= 0`, which drops any
    // referrer that merely *contains* the site's name -- "notexample.com" and
    // "example.com.evil.net" were both silently discarded as internal -- while
    // still counting a subdomain as external. Parse and compare properly.
    // Callers pass either a bare hostname or a full URL -- the server-side
    // module hands over an origin -- so normalise both sides the same way
    // rather than assuming one shape.
    const self = stripWww(hostnameOf(hostname));
    const referrerHostname = stripWww(hostnameOf(referrer));

    if (self && referrerHostname) {
        if (referrerHostname === self || referrerHostname.endsWith("." + self)) {
            return "";
        }
    }

    return referrer.split("?")[0] || "";
}

function hostnameOf(value: string): string {
    try {
        return new URL(value.indexOf("://") >= 0 ? value : "https://" + value)
            .hostname;
    } catch {
        return "";
    }
}

function stripWww(host: string): string {
    return (host || "").toLowerCase().replace(/^www\./, "");
}

export function getUtmParamsFromUrl(url: string): UtmParams {
    const utmParams: UtmParams = {};

    try {
        const urlObj = new URL(url);
        const params = urlObj.searchParams;

        const utmSource = params.get("utm_source");
        const utmMedium = params.get("utm_medium");
        const utmCampaign = params.get("utm_campaign");
        const utmTerm = params.get("utm_term");
        const utmContent = params.get("utm_content");

        if (utmSource) utmParams.us = utmSource;
        if (utmMedium) utmParams.um = utmMedium;
        if (utmCampaign) utmParams.uc = utmCampaign;
        if (utmTerm) utmParams.ut = utmTerm;
        if (utmContent) utmParams.uco = utmContent;
    } catch {
        // If URL parsing fails, return empty params
    }

    return utmParams;
}

export function getUtmParamsFromBrowserUrl(url: string): UtmParams {
    const utmParams: UtmParams = {};

    // Extract query string from path (browser-specific implementation)
    const queryStart = url.indexOf("?");
    if (queryStart === -1) return utmParams;

    const queryString = url.substring(queryStart + 1);
    const params = new URLSearchParams(queryString);

    const utmSource = params.get("utm_source");
    const utmMedium = params.get("utm_medium");
    const utmCampaign = params.get("utm_campaign");
    const utmTerm = params.get("utm_term");
    const utmContent = params.get("utm_content");

    if (utmSource) utmParams.us = utmSource;
    if (utmMedium) utmParams.um = utmMedium;
    if (utmCampaign) utmParams.uc = utmCampaign;
    if (utmTerm) utmParams.ut = utmTerm;
    if (utmContent) utmParams.uco = utmContent;

    return utmParams;
}

export function mergeUtmParams(...utmParamsArray: UtmParams[]): UtmParams {
    return Object.assign({}, ...utmParamsArray);
}

export function queryParamStringify(
    obj: { [key: string]: string | undefined },
    filterEmpty = false,
): string {
    return (
        "?" +
        Object.keys(obj)
            .filter((k) => {
                if (obj[k] === undefined) return false;
                if (filterEmpty && obj[k] === "") return false;
                return true;
            })
            .map(function (k) {
                return (
                    encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]!)
                );
            })
            .join("&")
    );
}
