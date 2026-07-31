import type { Client } from "./client";
import { getSessionClickId, rememberSessionReferrer } from "./attribution";
import { getHostnameAndPath, getReferrer } from "../shared/utils";

export interface TrackEventOpts {
    /** Numeric worth, e.g. an order total. */
    value?: number;
    /** ISO currency code, e.g. "INR". Only meaningful alongside value. */
    currency?: string;
    /** One free-form label, e.g. a plan name or form id. */
    label?: string;
}

/**
 * Records a custom event or conversion.
 *
 * Sent with sendBeacon where available: conversions usually fire on a form
 * submit or an outbound click, which is precisely when the page is being torn
 * down and a normal fetch would be cancelled.
 */
export function trackEvent(
    client: Client,
    name: string,
    type: "event" | "conversion",
    opts: TrackEventOpts = {},
) {
    if (!name) return;

    const location = window.location;
    const { hostname, path } = getHostnameAndPath(
        location.pathname + location.search || "/",
        true,
    );

    const referrer = getReferrer(hostname, document.referrer || "");
    const sessionReferrer = rememberSessionReferrer(referrer);
    const clickId = getSessionClickId(location.search);

    const params: Record<string, string> = {
        sid: client.siteId,
        n: name,
        t: type,
        h: hostname,
        p: path,
    };

    if (referrer) params.r = referrer;
    if (sessionReferrer && sessionReferrer !== referrer)
        params.sr = sessionReferrer;
    if (clickId) params.ci = clickId;
    if (typeof opts.value === "number" && isFinite(opts.value))
        params.v = String(opts.value);
    if (opts.currency) params.cur = opts.currency;
    if (opts.label) params.l = opts.label;

    const search = Object.keys(params)
        .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(params[k]))
        .join("&");

    // The reporter URL points at /collect; events go to /collect/event.
    const url = client.reporterUrl + "/event?" + search;

    try {
        if (navigator.sendBeacon && navigator.sendBeacon(url)) return;
    } catch {
        // Fall through to the image request below.
    }

    // Image request rather than fetch: it is not cancelled on unload, and it
    // needs no CORS preflight.
    const image = new Image();
    image.src = url;
}
