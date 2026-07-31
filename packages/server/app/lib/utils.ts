import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

// Was duplicated here as a second, local interface that had to be kept in
// step with the shared one by hand. Importing removes the drift.
import type { SearchFilters } from "./types";
// Relative, not the `~/` alias: this module is reachable from the Worker
// entry point, which is bundled without tsconfig path resolution.
import { isCustomRange, parseRange } from "../analytics/range";

dayjs.extend(utc);
dayjs.extend(timezone);

export function paramsFromUrl(url: string) {
    const searchParams = new URL(url).searchParams;
    const params: Record<string, string> = {};
    searchParams.forEach((value, key) => {
        params[key] = value;
    });
    return params;
}

export function getFiltersFromSearchParams(searchParams: URLSearchParams) {
    const filters: SearchFilters = {};

    if (searchParams.has("path")) {
        filters.path = searchParams.get("path") || "";
    }
    if (searchParams.has("referrer")) {
        filters.referrer = searchParams.get("referrer") || "";
    }
    if (searchParams.has("deviceType")) {
        filters.deviceType = searchParams.get("deviceType") || "";
    }
    if (searchParams.has("country")) {
        filters.country = searchParams.get("country") || "";
    }
    if (searchParams.has("browserName")) {
        filters.browserName = searchParams.get("browserName") || "";
    }
    if (searchParams.has("browserVersion")) {
        filters.browserVersion = searchParams.get("browserVersion") || "";
    }
    if (searchParams.has("channel")) {
        filters.channel = searchParams.get("channel") || "";
    }
    if (searchParams.has("referrerHost")) {
        filters.referrerHost = searchParams.get("referrerHost") || "";
    }
    if (searchParams.has("utmSource")) {
        filters.utmSource = searchParams.get("utmSource") || "";
    }
    if (searchParams.has("utmMedium")) {
        filters.utmMedium = searchParams.get("utmMedium") || "";
    }
    if (searchParams.has("utmCampaign")) {
        filters.utmCampaign = searchParams.get("utmCampaign") || "";
    }
    if (searchParams.has("utmTerm")) {
        filters.utmTerm = searchParams.get("utmTerm") || "";
    }
    if (searchParams.has("utmContent")) {
        filters.utmContent = searchParams.get("utmContent") || "";
    }

    return filters;
}

export function getUserTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        // Fallback to UTC if browser doesn't support Intl API
        return "UTC";
    }
}

export function getIntervalType(interval: string): "DAY" | "HOUR" {
    // A custom range is charted hourly only when it is a single day; beyond
    // that hourly points outnumber the pixels available to draw them.
    if (isCustomRange(interval)) {
        return parseRange(interval).days <= 1 ? "HOUR" : "DAY";
    }

    switch (interval) {
        case "today":
        case "yesterday":
        case "1d":
            return "HOUR";
        case "7d":
        case "30d":
        case "90d":
            return "DAY";
        default:
            return "DAY";
    }
}

export function getDateTimeRange(interval: string, tz: string) {
    let localDateTime = dayjs().utc();
    let localEndDateTime: dayjs.Dayjs | undefined;

    // Handled before the day-count arithmetic below, which parses the interval
    // as a number: on "2026-04-05..2026-07-31" that yields NaN, and every date
    // derived from it is an Invalid Date.
    if (isCustomRange(interval)) {
        const range = parseRange(interval, tz);
        return {
            startDate: dayjs.tz(range.start, tz).startOf("day").toDate(),
            // Inclusive of the last day, so a range ending today still shows
            // today's traffic.
            endDate: dayjs.tz(range.end, tz).endOf("day").toDate(),
        };
    }

    if (interval === "today") {
        localDateTime = localDateTime.tz(tz).startOf("day");
    } else if (interval === "yesterday") {
        localDateTime = localDateTime.tz(tz).startOf("day").subtract(1, "day");
        localEndDateTime = localDateTime.endOf("day").add(2, "ms");
    } else {
        const daysAgo = Number(interval.split("d")[0]);
        const intervalType = getIntervalType(interval);

        if (intervalType === "DAY") {
            localDateTime = localDateTime
                .subtract(daysAgo, "day")
                .tz(tz)
                .startOf("day");
        } else if (intervalType === "HOUR") {
            localDateTime = localDateTime
                .subtract(daysAgo, "day")
                .startOf("hour");
        }
    }

    if (!localEndDateTime) {
        localEndDateTime = dayjs().utc().tz(tz);
    }

    return {
        startDate: localDateTime.toDate(),
        endDate: localEndDateTime.toDate(),
    };
}

export function maskBrowserVersion(version?: string) {
    if (!version) return version;

    const majorEnd = version.indexOf(".");

    if (majorEnd != -1) {
        version =
            version.substring(0, majorEnd) +
            version.slice(majorEnd).replaceAll(/\.[^.]+/g, ".x");
    }

    return version;
}
