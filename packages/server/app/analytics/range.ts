/**
 * Date ranges, and which store can answer them.
 *
 * There are two stores with different shapes. Analytics Engine holds the last
 * 90 days at full fidelity and is the only one that knows about today. R2 holds
 * one pre-aggregated Arrow file per finished day and goes back as far as the
 * archive has been running -- or, for imported history, further back than
 * Analytics Engine ever went.
 *
 * A range can therefore need one store, the other, or both, and this module is
 * the single place that decides. Everything downstream just asks.
 */

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Analytics Engine's retention.
 *
 * The last day is deliberately treated as already expired: a query for
 * "90 days ago" that takes a second to run can land the other side of the
 * boundary and come back short, and a silently short answer is worse than
 * reading that day from the archive.
 */
export const AE_RETENTION_DAYS = 89;

export type RangeSource = "ae" | "archive" | "both";

export interface DateRange {
    /** Inclusive first day, YYYY-MM-DD. */
    start: string;
    /** Inclusive last day, YYYY-MM-DD. */
    end: string;
    /** How many days the range spans, inclusive. */
    days: number;
    /** True when the range includes today, which only Analytics Engine has. */
    includesToday: boolean;
}

export interface RoutedRange extends DateRange {
    source: RangeSource;
    /** Days Analytics Engine should answer, when it is involved. */
    aeStart: string | null;
    aeEnd: string | null;
    /** Days the archive should answer, when it is involved. */
    archiveStart: string | null;
    archiveEnd: string | null;
}

const CUSTOM = /^(\d{4}-\d{2}-\d{2})(?:\.\.|:)(\d{4}-\d{2}-\d{2})$/;

/** Named intervals, in days back from today. */
const NAMED_DAYS: Record<string, number> = {
    "1d": 1,
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "180d": 180,
    "365d": 365,
};

/**
 * Turns an interval token into concrete dates.
 *
 * Accepts the original tokens (`today`, `yesterday`, `7d`, …) so nothing that
 * already works has to change, plus `YYYY-MM-DD..YYYY-MM-DD` for an explicit
 * range. Anything unrecognised falls back to 7 days rather than throwing --
 * this reads a URL parameter, which anyone can type.
 */
export function parseRange(interval: string, tz?: string): DateRange {
    // Everything below works on plain YYYY-MM-DD strings. Day arithmetic on a
    // zone-attached dayjs object is not reliable -- subtracting days from a
    // `.tz()` value can land partway into a day and make a 7-day range come
    // back as 6. The zone only matters for deciding what "today" is, which is
    // the one place it is used.
    const today = dayjs().tz(tz).format("YYYY-MM-DD");

    const custom = CUSTOM.exec(interval || "");
    if (custom) {
        // Tolerate a reversed range instead of returning nothing.
        const [a, b] = [custom[1], custom[2]];
        const start = a <= b ? a : b;
        const end = a <= b ? b : a;
        // Never claim to cover days that have not happened.
        return build(start, end > today ? today : end, today);
    }

    if (interval === "today") return build(today, today, today);

    if (interval === "yesterday") {
        const y = shift(today, -1);
        return build(y, y, today);
    }

    const days = NAMED_DAYS[interval] ?? 7;
    // "7 days" means the last 7 days including today, not 8.
    return build(shift(today, -(days - 1)), today, today);
}

/** Moves a YYYY-MM-DD date by whole days. */
function shift(date: string, days: number): string {
    return dayjs.utc(date).add(days, "day").format("YYYY-MM-DD");
}

function build(start: string, end: string, today: string): DateRange {
    return {
        start,
        end,
        days: dayjs.utc(end).diff(dayjs.utc(start), "day") + 1,
        includesToday: end >= today,
    };
}

/**
 * Decides which store answers a range, splitting it when both are needed.
 *
 * The two halves never overlap: the archive stops the day before Analytics
 * Engine's window opens. Double-counting a day would be invisible in the
 * output and would inflate every number on the page.
 */
export function routeRange(
    range: DateRange,
    {
        tz,
        archiveEarliest,
        liveFrom,
    }: {
        tz?: string;
        archiveEarliest?: string | null;
        /**
         * First day this site's own collection is authoritative for.
         *
         * A site migrated from another tool has history in the archive that
         * overlaps Analytics Engine's window, and for those overlapping days
         * the archive is the fuller record. Without this the router would hand
         * them to the store that barely has them.
         */
        liveFrom?: string | null;
    } = {},
): RoutedRange {
    const today = dayjs().tz(tz).format("YYYY-MM-DD");
    const retentionFloor = dayjs
        .utc(today)
        .subtract(AE_RETENTION_DAYS, "day")
        .format("YYYY-MM-DD");

    // Whichever floor is later wins: retention is a hard limit, and live_from
    // is a deliberate statement that earlier days belong to the archive.
    const aeFloorStr =
        liveFrom && liveFrom > retentionFloor ? liveFrom : retentionFloor;

    const startsInAe = range.start >= aeFloorStr;
    const endsInAe = range.end >= aeFloorStr;

    if (startsInAe) {
        // Entirely inside retention -- the common case, and the fast one.
        return {
            ...range,
            source: "ae",
            aeStart: range.start,
            aeEnd: range.end,
            archiveStart: null,
            archiveEnd: null,
        };
    }

    // The archive cannot answer for days before it holds anything. Reporting
    // the truncation is the caller's job; here we just stop asking for days
    // that are certain to be empty.
    const archiveStart =
        archiveEarliest && archiveEarliest > range.start
            ? archiveEarliest
            : range.start;

    if (!endsInAe) {
        return {
            ...range,
            source: "archive",
            aeStart: null,
            aeEnd: null,
            archiveStart,
            archiveEnd: range.end,
        };
    }

    return {
        ...range,
        source: "both",
        aeStart: aeFloorStr,
        aeEnd: range.end,
        archiveStart,
        // One day short of the Analytics Engine window, so no day is counted
        // by both stores.
        archiveEnd: dayjs
            .utc(aeFloorStr)
            .subtract(1, "day")
            .format("YYYY-MM-DD"),
    };
}

/**
 * SQL bounds for the Analytics Engine half of a routed range.
 *
 * The end is exclusive and set to the start of the following day, so the last
 * day is included whole. Using the range's own end would cut it off at
 * midnight and quietly lose a day of traffic.
 */
export function rangeToSql(
    start: string,
    end: string,
    tz?: string,
): { startIntervalSql: string; endIntervalSql: string } {
    const startUtc = dayjs.tz(start, tz).startOf("day").utc();
    const endUtc = dayjs.tz(end, tz).startOf("day").add(1, "day").utc();

    return {
        startIntervalSql: `toDateTime('${startUtc.format("YYYY-MM-DD HH:mm:ss")}')`,
        endIntervalSql: `toDateTime('${endUtc.format("YYYY-MM-DD HH:mm:ss")}')`,
    };
}

/** True when an interval string is an explicit date range. */
export function isCustomRange(interval: string): boolean {
    return CUSTOM.test(interval || "");
}

/** The interval token for an explicit range. */
export function formatCustomRange(start: string, end: string): string {
    return `${start}..${end}`;
}

/**
 * Whether a range should be charted by day or by hour.
 *
 * Hourly only makes sense for a single day; beyond that it is 700+ points on a
 * chart a few hundred pixels wide.
 */
export function intervalTypeForRange(range: DateRange): "DAY" | "HOUR" {
    return range.days <= 1 ? "HOUR" : "DAY";
}
