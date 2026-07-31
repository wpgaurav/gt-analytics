/**
 * Custom events and conversions.
 *
 * These go to their own Analytics Engine dataset rather than sharing the
 * pageview one. A pageview and a conversion have almost nothing in common
 * beyond the site id, the pageview schema has three blobs left, and mixing
 * them would mean every pageview query had to filter out events.
 */

import { classifyChannel, detectClickId, referrerHost } from "./referrer";

export const EventColumnMappings = {
    siteId: "blob1",
    /** The name the site owner chose, e.g. "signup" or "purchase". */
    name: "blob2",
    /** "conversion" for revenue-ish goals, "event" for everything else. */
    type: "blob3",
    host: "blob4",
    path: "blob5",
    referrerHost: "blob6",
    channel: "blob7",
    utmSource: "blob8",
    utmMedium: "blob9",
    utmCampaign: "blob10",
    country: "blob11",
    currency: "blob12",
    clickId: "blob13",
    /** One free-form label, e.g. a plan name or form id. */
    label: "blob14",

    /** Monetary or numeric worth of the event. Zero when not supplied. */
    value: "double1",
} as const;

/** Names are used as report labels, so keep them short and predictable. */
const MAX_NAME_LENGTH = 64;
const MAX_LABEL_LENGTH = 128;

export interface EventDataPoint {
    siteId: string;
    name: string;
    type: string;
    host?: string;
    path?: string;
    referrerHost?: string;
    channel?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    country?: string;
    currency?: string;
    clickId?: string;
    label?: string;
    value: number;
}

export interface EventParams {
    sid?: string;
    /** Event name. */
    n?: string;
    /** Event type: "conversion" or "event". */
    t?: string;
    h?: string;
    p?: string;
    r?: string;
    sr?: string;
    ci?: string;
    us?: string;
    um?: string;
    uc?: string;
    /** Numeric value, e.g. order total. */
    v?: string;
    /** ISO currency code. */
    cur?: string;
    /** Free-form label. */
    l?: string;
}

export function buildEventDataPoint(
    params: EventParams,
    extra: { country?: string } = {},
): EventDataPoint | { error: string } {
    const siteId = (params.sid || "").trim();
    if (!siteId) return { error: "Missing siteId" };

    const name = truncate((params.n || "").trim(), MAX_NAME_LENGTH);
    if (!name) return { error: "Missing event name" };

    const immediateReferrer = params.r || "";
    const sessionReferrer = params.sr || "";
    const attributedReferrer =
        referrerHost(immediateReferrer, params.h) !== ""
            ? immediateReferrer
            : sessionReferrer || immediateReferrer;

    const clickId = detectClickId(params.ci ? { [params.ci]: "1" } : null);

    // A value that is not a finite number is dropped rather than recorded as
    // NaN, which would poison every SUM over the column.
    const parsedValue = Number(params.v);
    const value = Number.isFinite(parsedValue) ? parsedValue : 0;

    return {
        siteId,
        name,
        type: params.t === "conversion" ? "conversion" : "event",
        host: params.h,
        path: params.p,
        referrerHost: referrerHost(attributedReferrer, params.h),
        channel: classifyChannel({
            referrer: attributedReferrer,
            selfHost: params.h,
            utmMedium: params.um,
            utmSource: params.us,
            clickId: params.ci,
        }),
        utmSource: params.us,
        utmMedium: params.um,
        utmCampaign: params.uc,
        country: extra.country,
        currency: truncate((params.cur || "").trim().toUpperCase(), 8),
        clickId: clickId?.name || params.ci || "",
        label: truncate((params.l || "").trim(), MAX_LABEL_LENGTH),
        value,
    };
}

export function writeEventDataPoint(
    dataset: AnalyticsEngineDataset | undefined,
    data: EventDataPoint,
) {
    const datapoint = {
        indexes: [data.siteId || ""],
        blobs: [
            data.siteId || "", // blob1
            data.name || "", // blob2
            data.type || "", // blob3
            data.host || "", // blob4
            data.path || "", // blob5
            data.referrerHost || "", // blob6
            data.channel || "", // blob7
            data.utmSource || "", // blob8
            data.utmMedium || "", // blob9
            data.utmCampaign || "", // blob10
            data.country || "", // blob11
            data.currency || "", // blob12
            data.clickId || "", // blob13
            data.label || "", // blob14
        ],
        doubles: [data.value || 0],
    };

    if (!dataset) {
        console.log("Can't save event: events dataset unavailable");
        return;
    }

    dataset.writeDataPoint(datapoint);
}

function truncate(value: string, max: number): string {
    if (!value) return "";
    return value.length > max ? value.slice(0, max) : value;
}
