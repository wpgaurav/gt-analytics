import type { Client } from "./client";
import { instrumentHistoryBuiltIns } from "./instrument";
import { makeRequest, checkCacheStatus } from "./request";
import {
    getHostnameAndPath,
    getReferrer,
    getUtmParamsFromBrowserUrl,
    isLocalhostAddress,
} from "../shared/utils";
import { buildCollectRequestParams } from "../shared/request";
import {
    getSessionClickId,
    rememberEntryPath,
    rememberSessionReferrer,
} from "./attribution";

export type TrackPageviewOpts = {
    url?: string;
    referrer?: string;
};

export function autoTrackPageviews(client: Client) {
    const cleanupFn = instrumentHistoryBuiltIns(() => {
        void trackPageview(client);
    });

    void trackPageview(client);

    return cleanupFn;
}

function getCanonicalUrl() {
    const canonical = document.querySelector(
        'link[rel="canonical"][href]',
    ) as HTMLLinkElement;
    if (!canonical) {
        return null;
    }

    const a = document.createElement("a");
    a.href = canonical.href;
    return a;
}

function getBrowserReferrer(hostname: string, referrer: string): string {
    // First, check if we have an explicit referrer parameter
    if (referrer) {
        return getReferrer(hostname, referrer);
    }

    // If no explicit referrer, check document.referrer
    if (document.referrer && document.referrer.indexOf(hostname) < 0) {
        return getReferrer(hostname, document.referrer);
    }

    // If still no referrer, check query parameters that explicitly name one.
    //
    // utm_source and `source` used to be in this list, which conflated a
    // campaign source with a referrer: a link tagged ?utm_source=chatgpt.com
    // recorded "chatgpt.com" as the referrer -- not a URL, so it could not be
    // linked to and polluted the referrer report. The campaign source has its
    // own column; it does not belong here.
    const urlParams = new URLSearchParams(window.location.search);
    const referrerParams = ["ref", "referer", "referrer"];

    for (const param of referrerParams) {
        const value = urlParams.get(param);
        if (value) {
            return getReferrer(hostname, value);
        }
    }

    return getReferrer(hostname, "");
}

export async function trackPageview(
    client: Client,
    opts: TrackPageviewOpts = {},
) {
    const canonical = getCanonicalUrl();
    const location = canonical ?? window.location;

    if (
        !client.reportOnLocalhost &&
        isLocalhostAddress(window.location.hostname)
    ) {
        return;
    }

    // if host is empty, we're probably loading a file:/// URI
    // -- exit early if this is not an Electron app
    if (location.host === "" && navigator.userAgent.indexOf("Electron") < 0) {
        return;
    }

    const url = opts.url || location.pathname + location.search || "/";

    const { hostname, path } = getHostnameAndPath(url, true);
    const referrer = getBrowserReferrer(hostname, opts.referrer || "");

    // Campaign parameters come from the address bar, never from the canonical.
    //
    // `location` above is the canonical link when the page declares one, which
    // every WordPress page with an SEO plugin does -- and a canonical URL
    // deliberately omits the query string. Reading UTM from it silently
    // dropped all five parameters on exactly the pages that matter, so a
    // tagged campaign link recorded no campaign at all.
    //
    // An explicit opts.url still wins: a caller passing a URL means it.
    const utmParams = getUtmParamsFromBrowserUrl(
        opts.url || window.location.search,
    );

    let hitType: string | undefined;
    try {
        const cacheStatus = await checkCacheStatus(
            client.reporterUrl,
            client.siteId,
        );
        hitType = cacheStatus.ht.toString();
    } catch {
        // If cache check fails, we proceed without hit count data
        // The collect endpoint will handle the missing parameters
    }

    // First-touch attribution for the session, so pageviews after the landing
    // page stay credited to wherever the visit actually came from.
    const sessionReferrer = rememberSessionReferrer(referrer);
    const clickId = getSessionClickId(window.location.search);
    const entryPath = rememberEntryPath(path);

    const requestParams = buildCollectRequestParams(
        client.siteId,
        hostname,
        path,
        referrer,
        utmParams,
        hitType,
        { sessionReferrer, clickId, entryPath },
    );

    makeRequest(client.reporterUrl, requestParams);
}
