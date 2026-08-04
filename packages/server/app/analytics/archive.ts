/**
 * Long-term storage: daily Arrow archives in R2.
 *
 * Analytics Engine retains 90 days and cannot be backdated -- `writeDataPoint`
 * has no timestamp field -- so anything older than that, and anything imported
 * from another tool, has to live here. The nightly rollup writes one Arrow
 * file per day; this module reads them back.
 *
 * Files are pre-aggregated per day, so a range query is "read N files, sum
 * them", not "scan raw events".
 */

import { tableFromIPC } from "apache-arrow";

/** One archived row: a dimension combination and its counts for a day. */
export interface ArchiveRow {
    date: string;
    siteId: string;
    views: number;
    visitors: number;
    bounces: number;
    /** Daily, site-scoped HMAC. Absent on legacy/imported archive rows. */
    visitorKey?: string;
    [dimension: string]: string | number | undefined;
}

/**
 * The dimensions every archived day carries.
 *
 * Archive rows are one per *combination* of these, so each addition multiplies
 * the row count rather than adding to it. That is the whole reason the list is
 * curated instead of being "every column".
 *
 * Deliberately absent:
 *
 * - `userAgent`, the raw string. Effectively unique per visitor, and already
 *   decomposed at collection time into browserName, browserVersion, deviceType
 *   and deviceModel -- all four of which are here. Keeping it would multiply
 *   every day's file for nothing the dashboard can report on.
 * - `newVisitor` and `bounce`, which are not dimensions. Legacy visitor counts
 *   and bounces are stored as measures. New visitor counts are reconstructed
 *   by deduplicating the privacy-preserving visitorKey stored with each row.
 */
export const ARCHIVE_DIMENSIONS = [
    "path",
    "entryPath",
    "referrer",
    "referrerHost",
    "channel",
    "clickId",
    "country",
    "browserName",
    "browserVersion",
    "deviceType",
    "deviceModel",
    "host",
    "utmSource",
    "utmMedium",
    "utmCampaign",
    "utmTerm",
    "utmContent",
] as const;

/** Dimensions a report can group an archived range by. */
export type ArchiveDimension = (typeof ARCHIVE_DIMENSIONS)[number];

export function archiveKey(date: string): string {
    return `analytics-${date}.arrow`;
}

/** Dates between from and to inclusive, as YYYY-MM-DD. */
export function datesInRange(from: string, to: string): string[] {
    const dates: string[] = [];
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return dates;
    }

    for (
        let d = new Date(start);
        d.getTime() <= end.getTime();
        d.setUTCDate(d.getUTCDate() + 1)
    ) {
        dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
}

/**
 * Reads one day's archive. Returns an empty array when the day was never
 * archived, which is the normal case for a gap rather than an error.
 */
export async function readArchiveDay(
    bucket: R2Bucket,
    date: string,
): Promise<ArchiveRow[]> {
    const object = await bucket.get(archiveKey(date));
    if (!object) return [];

    try {
        const buffer = await object.arrayBuffer();
        const table = tableFromIPC(new Uint8Array(buffer));
        return table.toArray().map((row) => {
            const record = row.toJSON() as Record<string, unknown>;
            const out: ArchiveRow = {
                date: String(record.date ?? date),
                siteId: String(record.siteId ?? ""),
                views: Number(record.views) || 0,
                visitors: Number(record.visitors) || 0,
                bounces: Number(record.bounces) || 0,
            };
            for (const [key, value] of Object.entries(record)) {
                if (key in out) continue;
                out[key] =
                    typeof value === "number" ? value : String(value ?? "");
            }
            return out;
        });
    } catch (error) {
        // A corrupt file must not take the whole range down; the rest of the
        // days are still worth showing.
        console.error(`could not read archive for ${date}`, error);
        return [];
    }
}

/**
 * Reads a date range, bounded so one query cannot fan out indefinitely.
 *
 * R2 reads are issued in parallel batches: a five-year range is 1,800 objects,
 * and doing those serially would take minutes.
 */
export async function readArchiveRange(
    bucket: R2Bucket,
    from: string,
    to: string,
    {
        concurrency = 25,
        maxDays = 400,
    }: { concurrency?: number; maxDays?: number } = {},
): Promise<{ rows: ArchiveRow[]; daysRead: number; truncated: boolean }> {
    const allDates = datesInRange(from, to);
    const truncated = allDates.length > maxDays;

    // Keep the most recent days when a range is longer than the cap -- recent
    // data is what a truncated answer should be biased toward.
    const dates = truncated ? allDates.slice(-maxDays) : allDates;

    const rows: ArchiveRow[] = [];
    for (let i = 0; i < dates.length; i += concurrency) {
        const batch = dates.slice(i, i + concurrency);
        const results = await Promise.all(
            batch.map((date) => readArchiveDay(bucket, date)),
        );
        for (const dayRows of results) rows.push(...dayRows);
    }

    return { rows, daysRead: dates.length, truncated };
}

export interface AggregateOptions {
    siteId: string;
    dimension: ArchiveDimension;
    /** Only rows matching every filter are counted. */
    filters?: Partial<Record<ArchiveDimension, string>>;
    limit?: number;
}

/** Groups archived rows by one dimension, summing views and visitors. */
export function aggregateByDimension(
    rows: ArchiveRow[],
    { siteId, dimension, filters = {}, limit = 10 }: AggregateOptions,
): [string, number, number][] {
    const totals = new Map<
        string,
        { legacyVisitors: number; visitorKeys: Set<string>; views: number }
    >();

    for (const row of rows) {
        if (siteId && row.siteId !== siteId) continue;

        let matches = true;
        for (const [key, value] of Object.entries(filters)) {
            if (value && String(row[key] ?? "") !== value) {
                matches = false;
                break;
            }
        }
        if (!matches) continue;

        const key = String(row[dimension] ?? "");
        const existing = totals.get(key) ?? {
            legacyVisitors: 0,
            visitorKeys: new Set<string>(),
            views: 0,
        };
        const visitorKey = String(row.visitorKey ?? "");
        if (visitorKey) existing.visitorKeys.add(visitorKey);
        else existing.legacyVisitors += row.visitors;
        existing.views += row.views;
        totals.set(key, existing);
    }

    return [...totals.entries()]
        .map(
            ([key, counts]) =>
                [
                    key,
                    counts.legacyVisitors + counts.visitorKeys.size,
                    counts.views,
                ] as [string, number, number],
        )
        .sort((a, b) => b[2] - a[2])
        .slice(0, limit);
}

/** Site-level totals for an archived range. */
export function totalsForSite(
    rows: ArchiveRow[],
    siteId: string,
): { views: number; visitors: number; bounces: number } {
    const totals = { views: 0, visitors: 0, bounces: 0 };
    const visitorKeys = new Set<string>();
    for (const row of rows) {
        if (siteId && row.siteId !== siteId) continue;
        totals.views += row.views;
        const visitorKey = String(row.visitorKey ?? "");
        if (visitorKey) visitorKeys.add(visitorKey);
        else totals.visitors += row.visitors;
        totals.bounces += row.bounces;
    }
    totals.visitors += visitorKeys.size;
    return totals;
}

/** Per-day series for an archived range, oldest first. */
export function seriesByDay(
    rows: ArchiveRow[],
    siteId: string,
): { date: string; views: number; visitors: number; bounces: number }[] {
    const byDate = new Map<
        string,
        {
            views: number;
            legacyVisitors: number;
            visitorKeys: Set<string>;
            bounces: number;
        }
    >();

    for (const row of rows) {
        if (siteId && row.siteId !== siteId) continue;
        const existing = byDate.get(row.date) ?? {
            views: 0,
            legacyVisitors: 0,
            visitorKeys: new Set<string>(),
            bounces: 0,
        };
        existing.views += row.views;
        const visitorKey = String(row.visitorKey ?? "");
        if (visitorKey) existing.visitorKeys.add(visitorKey);
        else existing.legacyVisitors += row.visitors;
        existing.bounces += row.bounces;
        byDate.set(row.date, existing);
    }

    return [...byDate.entries()]
        .map(([date, counts]) => ({
            date,
            views: counts.views,
            visitors: counts.legacyVisitors + counts.visitorKeys.size,
            bounces: counts.bounces,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The earliest and latest archived dates.
 *
 * Used to cap the date picker at data that actually exists rather than
 * advertising a range the archive cannot answer.
 */
export async function archiveBounds(
    bucket: R2Bucket,
): Promise<{ earliest: string | null; latest: string | null; days: number }> {
    const dates: string[] = [];
    let cursor: string | undefined;

    do {
        const listing = await bucket.list({
            prefix: "analytics-",
            cursor,
            limit: 1000,
        });

        for (const object of listing.objects) {
            const match = object.key.match(
                /^analytics-(\d{4}-\d{2}-\d{2})\.arrow$/,
            );
            if (match) dates.push(match[1]);
        }

        cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor);

    if (dates.length === 0) return { earliest: null, latest: null, days: 0 };

    dates.sort();
    return {
        earliest: dates[0],
        latest: dates[dates.length - 1],
        days: dates.length,
    };
}
