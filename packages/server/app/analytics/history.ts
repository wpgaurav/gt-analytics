/**
 * Query router: reads whichever store can answer the range asked for.
 *
 * Analytics Engine answers the last 90 days; the R2 archive answers everything
 * older. A range that spans the boundary is answered by both and merged here,
 * so a report never has to know which store its numbers came from.
 *
 * The merge only ever adds. Each store owns a disjoint set of days (see
 * routeRange), so a day is counted exactly once no matter how a range falls.
 */

import type { AnalyticsEngineAPI } from "./query";
import type { SearchFilters } from "~/lib/types";
import {
    aggregateByDimension,
    archiveBounds,
    readArchiveRange,
    seriesByDay,
    totalsForSite,
    type ArchiveDimension,
    type ArchiveRow,
} from "./archive";
import { parseRange, routeRange, type RangeSource } from "./range";
// Relative, not the `~/` alias: this module is reachable from the Worker
// entry point, which is bundled without tsconfig path resolution.
import { listSiteLiveFrom } from "../sites/sites";
import { getDateTimeRange } from "../lib/utils";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

export interface Counts {
    views: number;
    visitors: number;
    bounces: number;
}

export interface RangedResult<T> {
    data: T;
    /** Which stores answered, so a report can say when history is partial. */
    source: RangeSource;
    /** True when the archive could not cover the whole requested range. */
    truncated: boolean;
}

export class HistoryAPI {
    /** Memoized for the life of a request; one D1 read, not one per card. */
    private liveFrom: Promise<Record<string, string>> | null = null;

    constructor(
        private ae: AnalyticsEngineAPI,
        private bucket: R2Bucket | undefined,
        private sitesDb?: D1Database,
    ) {}

    /** Whether long-term history is available at all. */
    get hasArchive(): boolean {
        return Boolean(this.bucket);
    }

    private async liveFromFor(siteId: string): Promise<string | null> {
        if (!this.sitesDb) return null;

        if (!this.liveFrom) {
            this.liveFrom = listSiteLiveFrom(this.sitesDb).catch((error) => {
                // A missing cutover date costs fidelity on migrated history.
                // Failing the whole report over it would cost everything.
                console.error("could not read site live_from", error);
                return {};
            });
        }

        return (await this.liveFrom)[siteId] ?? null;
    }

    /** The routed range for a site, honouring its cutover date. */
    private async route(siteId: string, interval: string, tz?: string) {
        return routeRange(parseRange(interval, tz), {
            tz,
            liveFrom: await this.liveFromFor(siteId),
        });
    }

    async bounds() {
        if (!this.bucket) return { earliest: null, latest: null, days: 0 };
        return archiveBounds(this.bucket);
    }

    /**
     * Reads the archive half of a range.
     *
     * Filters are applied here rather than in a query: archive rows are already
     * aggregated, so filtering is a scan over a few thousand rows in memory,
     * not a database operation.
     */
    private async archiveRows(
        start: string,
        end: string,
        filters: SearchFilters,
    ): Promise<{ rows: ArchiveRow[]; truncated: boolean }> {
        if (!this.bucket) return { rows: [], truncated: false };

        const { rows, truncated } = await readArchiveRange(
            this.bucket,
            start,
            end,
        );

        return { rows: applyFilters(rows, filters), truncated };
    }

    async getCounts(
        siteId: string,
        interval: string,
        tz?: string,
        filters: SearchFilters = {},
    ): Promise<RangedResult<Counts>> {
        const route = await this.route(siteId, interval, tz);
        const totals: Counts = { views: 0, visitors: 0, bounces: 0 };
        let truncated = false;

        if (route.aeStart && route.aeEnd) {
            const live = await this.ae.getCounts(
                siteId,
                // Untouched when nothing needs splitting. Rewriting it into a
                // date range would change what sub-day intervals mean: "1d" is
                // a rolling 24 hours, while a date range is a calendar day.
                route.source === "ae"
                    ? interval
                    : `${route.aeStart}..${route.aeEnd}`,
                tz,
                filters,
            );
            totals.views += live.views;
            totals.visitors += live.visitors;
            totals.bounces += live.bounces;
        }

        if (route.archiveStart && route.archiveEnd) {
            const archived = await this.archiveRows(
                route.archiveStart,
                route.archiveEnd,
                filters,
            );
            truncated = archived.truncated;
            const sums = totalsForSite(archived.rows, siteId);
            totals.views += sums.views;
            totals.visitors += sums.visitors;
            totals.bounces += sums.bounces;
        }

        return { data: totals, source: route.source, truncated };
    }

    /**
     * Daily series across a range.
     *
     * Always by day. The hourly shape only exists for single-day views, which
     * are inside Analytics Engine's window by definition and never reach the
     * archive -- archived days have no sub-day resolution to give.
     */
    async getSeries(
        siteId: string,
        interval: string,
        tz?: string,
        filters: SearchFilters = {},
    ): Promise<
        RangedResult<
            { date: string; views: number; visitors: number; bounces: number }[]
        >
    > {
        const route = await this.route(siteId, interval, tz);
        const zone = tz ?? "UTC";
        const byDate = new Map<
            string,
            { views: number; visitors: number; bounces: number }
        >();
        let truncated = false;

        if (route.archiveStart && route.archiveEnd) {
            const archived = await this.archiveRows(
                route.archiveStart,
                route.archiveEnd,
                filters,
            );
            truncated = archived.truncated;
            for (const point of seriesByDay(archived.rows, siteId)) {
                byDate.set(dayKeyFromLocalDate(point.date, zone), {
                    views: point.views,
                    visitors: point.visitors,
                    bounces: point.bounces,
                });
            }
        }

        if (route.aeStart && route.aeEnd) {
            const { start, end } =
                route.source === "ae"
                    ? (() => {
                          const bounds = getDateTimeRange(interval, zone);
                          return {
                              start: bounds.startDate,
                              end: bounds.endDate,
                          };
                      })()
                    : {
                          // Built in the report's timezone. `new Date("...T00:00:00")`
                          // parses as the *server's* local time, which put the
                          // window 5.5 hours early and made Analytics Engine
                          // bucket the day at 18:30 boundaries -- producing a
                          // duplicate day and a day of zeroes on the chart.
                          start: dayjs
                              .tz(route.aeStart, zone)
                              .startOf("day")
                              .toDate(),
                          end: dayjs
                              .tz(route.aeEnd, zone)
                              .endOf("day")
                              .toDate(),
                      };
            const live = await this.ae.getViewsGroupedByInterval(
                siteId,
                "DAY",
                start,
                end,
                tz,
                filters,
            );

            for (const [stamp, counts] of live) {
                const date = dayKeyFromLocalDate(
                    localDateFromAeKey(stamp, zone),
                    zone,
                );
                const existing = byDate.get(date) ?? {
                    views: 0,
                    visitors: 0,
                    bounces: 0,
                };
                existing.views += counts.views;
                existing.visitors += counts.visitors;
                existing.bounces += counts.bounces;
                byDate.set(date, existing);
            }
        }

        const data = [...byDate.entries()]
            .map(([date, counts]) => ({ date, ...counts }))
            .sort((a, b) => a.date.localeCompare(b.date));

        return { data, source: route.source, truncated };
    }

    /**
     * Visitors per value of one dimension, in the shape the cards already
     * expect: `[value, visitors][]`, ranked, paged.
     *
     * This exists so the dozen `getCountByX` cards can be routed by changing
     * which object they call rather than how they read the result.
     */
    async getVisitorCountByColumn(
        siteId: string,
        dimension: ArchiveDimension,
        interval: string,
        tz?: string,
        filters: SearchFilters = {},
        page = 1,
        limit = 10,
    ): Promise<[string, number][]> {
        const route = await this.route(siteId, interval, tz);

        // Nothing archived to merge: use the existing query directly and keep
        // its paging, which the archive path has to reimplement.
        if (route.source === "ae") {
            return this.ae.getVisitorCountByColumn(
                siteId,
                dimension,
                interval,
                tz,
                filters,
                page,
                limit,
            );
        }

        const merged = await this.getByDimension(
            siteId,
            dimension,
            interval,
            tz,
            filters,
            // getByDimension ranks by views; this card ranks by visitors, and
            // the two orders are not identical. Over-fetching leaves room to
            // re-rank without a row that is high in visitors and low in views
            // having already been cut.
            page * limit * 5,
        );

        return Object.entries(merged.data)
            .map(([key, counts]) => [key, counts.visitors] as [string, number])
            .sort((a, b) => b[1] - a[1])
            .slice((page - 1) * limit, page * limit);
    }

    /**
     * Visitors *and* views per value, as `[value, visitors, views][]`.
     *
     * The Paths card shows both columns, so it cannot use the visitors-only
     * shape above without dropping one of them.
     */
    async getAllCountsByColumn(
        siteId: string,
        dimension: ArchiveDimension,
        interval: string,
        tz?: string,
        filters: SearchFilters = {},
        page = 1,
        limit = 10,
    ): Promise<[string, number, number][]> {
        const route = await this.route(siteId, interval, tz);

        if (route.source === "ae") {
            const live = await this.ae.getAllCountsByColumn(
                siteId,
                dimension,
                interval,
                tz,
                filters,
                page,
                limit,
            );
            return Object.entries(live)
                .map(
                    ([key, counts]) =>
                        [key, counts.visitors, counts.views] as [
                            string,
                            number,
                            number,
                        ],
                )
                // Object key order is insertion order, not rank. Ranking by
                // visitors here matches what the card used to do for itself.
                .sort((a, b) => b[1] - a[1]);
        }

        const merged = await this.getByDimension(
            siteId,
            dimension,
            interval,
            tz,
            filters,
            page * limit,
        );

        return Object.entries(merged.data)
            .map(
                ([key, counts]) =>
                    [key, counts.visitors, counts.views] as [
                        string,
                        number,
                        number,
                    ],
            )
            .sort((a, b) => b[1] - a[1])
            .slice((page - 1) * limit, page * limit);
    }

    /**
     * Top values for one dimension.
     *
     * When both stores contribute, each is asked for more rows than the caller
     * wants before merging. A value ranked eleventh in each half can outrank
     * one ranked first in only one of them, so merging two top-tens would put
     * the wrong rows on the page.
     */
    async getByDimension(
        siteId: string,
        dimension: ArchiveDimension,
        interval: string,
        tz?: string,
        filters: SearchFilters = {},
        limit = 10,
    ): Promise<RangedResult<Record<string, Counts>>> {
        const route = await this.route(siteId, interval, tz);
        const merged = new Map<string, Counts>();
        let truncated = false;

        const overFetch = route.source === "both" ? limit * 5 : limit;

        if (route.aeStart && route.aeEnd) {
            const live = await this.ae.getAllCountsByColumn(
                siteId,
                dimension,
                `${route.aeStart}..${route.aeEnd}`,
                tz,
                filters,
                1,
                overFetch,
            );
            for (const [key, counts] of Object.entries(live)) {
                add(merged, key, counts);
            }
        }

        if (route.archiveStart && route.archiveEnd) {
            const archived = await this.archiveRows(
                route.archiveStart,
                route.archiveEnd,
                filters,
            );
            truncated = archived.truncated;

            for (const [key, visitors, views] of aggregateByDimension(
                archived.rows,
                { siteId, dimension, limit: overFetch },
            )) {
                add(merged, key, { views, visitors, bounces: 0 });
            }
        }

        const data = Object.fromEntries(
            [...merged.entries()]
                .sort((a, b) => b[1].views - a[1].views)
                .slice(0, limit),
        );

        return { data, source: route.source, truncated };
    }
}

/**
 * One key per day, in the form the rest of the app already uses.
 *
 * Analytics Engine keys a day by the *UTC instant* of that day's local
 * midnight -- in Asia/Kolkata, 2026-07-31 is keyed "2026-07-30 18:30:00" --
 * while the archive knows only the date. Two consequences, both of which
 * showed up on the chart:
 *
 * Mixing the formats breaks the sort, because a space sorts before "T", so a
 * day's live half landed ahead of its archived half instead of merging with
 * it. And taking the date off the front of an Analytics Engine key gives the
 * wrong day for any timezone behind UTC midnight, which folded today's
 * traffic into yesterday.
 *
 * So both halves are converted to a local date and re-keyed the same way
 * Analytics Engine would key it. For a range it answers alone, the output is
 * byte-identical to before.
 */
function dayKeyFromLocalDate(localDate: string, tz: string): string {
    return dayjs.tz(localDate, tz).utc().format("YYYY-MM-DD HH:mm:ss");
}

function localDateFromAeKey(stamp: string, tz: string): string {
    return dayjs.utc(String(stamp)).tz(tz).format("YYYY-MM-DD");
}

function add(target: Map<string, Counts>, key: string, counts: Counts) {
    const existing = target.get(key) ?? { views: 0, visitors: 0, bounces: 0 };
    existing.views += counts.views || 0;
    existing.visitors += counts.visitors || 0;
    existing.bounces += counts.bounces || 0;
    target.set(key, existing);
}

/**
 * Applies dashboard filters to archived rows.
 *
 * Only the dimensions the archive actually stores can be filtered. A filter on
 * anything else returns nothing rather than silently ignoring the filter --
 * showing unfiltered numbers under a filter label is the more damaging failure.
 */
function applyFilters(rows: ArchiveRow[], filters: SearchFilters): ArchiveRow[] {
    const entries = Object.entries(filters).filter(
        ([, value]) => value !== undefined && value !== "",
    );
    if (entries.length === 0) return rows;

    return rows.filter((row) =>
        entries.every(([key, value]) => String(row[key] ?? "") === value),
    );
}
