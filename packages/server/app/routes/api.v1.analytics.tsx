import type { LoaderFunctionArgs } from "react-router";
import { EventsAPI } from "~/analytics/events-query";
import { DEFAULT_EVENTS_DATASET } from "~/analytics/events-dataset";
import type { ArchiveDimension } from "~/analytics/archive";
import { requireApiAuth } from "~/lib/api-auth";
import { apiJson, readApiQuery } from "~/lib/api-input";

const DIMENSIONS = [
    "referrerHost",
    "channel",
    "country",
    "browserName",
    "browserVersion",
    "deviceType",
    "deviceModel",
    "utmSource",
    "utmMedium",
    "utmCampaign",
    "utmTerm",
    "utmContent",
] as const satisfies readonly ArchiveDimension[];

export async function loader({ request, context }: LoaderFunctionArgs) {
    const principal = await requireApiAuth(
        request,
        context.cloudflare.env,
        "analytics:read",
    );
    const { site, interval, timezone, limit, filters } = readApiQuery(
        request,
        principal.siteId,
    );
    // A combined report fans out across every dashboard section. Keep each
    // section bounded so one large `limit` cannot exhaust the Worker's CPU or
    // memory; dedicated dashboard tables display no more than 20 rows.
    const reportLimit = Math.min(limit, 20);
    const env = context.cloudflare.env;
    const eventsApi = new EventsAPI(
        env.CF_ACCOUNT_ID,
        env.CF_BEARER_TOKEN,
        env.CF_EVENTS_DATASET || DEFAULT_EVENTS_DATASET,
    );

    const [counts, series] = await Promise.all([
        context.history.getCounts(site, interval, timezone, filters),
        context.history.getSeries(site, interval, timezone, filters),
    ]);
    const [pages, referrers, events, eventDetails, durations] =
        await Promise.all([
            context.analyticsEngine.getPageMetrics(
                site,
                interval,
                timezone,
                filters,
                reportLimit,
            ).catch((error: unknown) => optionalFailure("pages", error, [])),
            context.analyticsEngine.getReferrersGrouped(
                site,
                interval,
                timezone,
                filters,
                reportLimit * 2,
            ).catch((error: unknown) =>
                optionalFailure("referrers", error, []),
            ),
            eventsApi.getEventCounts(
                site,
                interval,
                timezone,
                undefined,
                reportLimit,
                filters,
            ).catch((error: unknown) =>
                optionalFailure("events", error, []),
            ),
            eventsApi.getEventBreakdown(
                site,
                interval,
                timezone,
                undefined,
                reportLimit * 25,
                filters,
            ).catch((error: unknown) =>
                optionalFailure("event details", error, []),
            ),
            eventsApi
                .getDurationByPath(site, interval, timezone, reportLimit)
                .catch((error: unknown) =>
                    optionalFailure(
                        "durations",
                        error,
                        new Map<
                            string,
                            { avgSeconds: number; samples: number }
                        >(),
                    ),
                ),
        ]);
    const dimensionRows = await Promise.all(
        DIMENSIONS.map((dimension) =>
            context.history.getAllCountsByColumn(
                site,
                dimension,
                interval,
                timezone,
                filters,
                1,
                reportLimit,
            ).catch((error: unknown) =>
                optionalFailure(`dimension ${dimension}`, error, []),
            ),
        ),
    );

    const dimensions = Object.fromEntries(
        DIMENSIONS.map((dimension, index) => [
            dimension,
            dimensionRows[index].map(
                ([value, visitors, views]: [string, number, number]) => ({
                    value,
                    visitors,
                    views,
                }),
            ),
        ]),
    );
    const pageData = pages.map(
        (page: {
            path: string;
            visitors: number;
            views: number;
            entries: number;
            bounceRate: number | null;
        }) => ({
            ...page,
            avgDurationSeconds: durations.get(page.path)?.avgSeconds ?? null,
            durationSamples: durations.get(page.path)?.samples ?? 0,
        }),
    );
    let durationTotal = 0;
    let durationSamples = 0;
    for (const value of durations.values()) {
        durationTotal += value.avgSeconds * value.samples;
        durationSamples += value.samples;
    }

    return apiJson({
        data: {
            site,
            interval,
            timezone,
            generatedAt: new Date().toISOString(),
            resultLimit: reportLimit,
            source: counts.source,
            truncated: counts.truncated || series.truncated,
            summary: {
                ...counts.data,
                bounceRate: counts.data.visitors
                    ? counts.data.bounces / counts.data.visitors
                    : null,
                avgDurationSeconds: durationSamples
                    ? durationTotal / durationSamples
                    : null,
                durationSamples,
            },
            series: series.data,
            pages: pageData,
            referrers,
            events: events.map(([name, count, value, type]) => ({
                name,
                type,
                count,
                value,
            })),
            eventDetails,
            dimensions,
        },
    });
}

function optionalFailure<T>(section: string, error: unknown, fallback: T): T {
    console.error(`API analytics ${section} query failed`, error);
    return fallback;
}
