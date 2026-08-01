import type { LoaderFunctionArgs } from "react-router";
import { EventsAPI } from "~/analytics/events-query";
import { DEFAULT_EVENTS_DATASET } from "~/analytics/events-dataset";
import type { ArchiveDimension } from "~/analytics/archive";
import { requireApiAuth } from "~/lib/api-auth";
import { apiJson, readApiQuery } from "~/lib/api-input";

const DIMENSIONS = [
    "path", "referrer", "referrerHost", "channel", "country", "browserName",
    "browserVersion", "deviceType", "deviceModel", "utmSource", "utmMedium",
    "utmCampaign", "utmTerm", "utmContent",
] as const satisfies readonly ArchiveDimension[];

export async function loader({ request, context }: LoaderFunctionArgs) {
    await requireApiAuth(request, context.cloudflare.env, "analytics:read");
    const { site, interval, timezone, limit, filters } = readApiQuery(request);
    const env = context.cloudflare.env;
    const eventsApi = new EventsAPI(env.CF_ACCOUNT_ID, env.CF_BEARER_TOKEN, env.CF_EVENTS_DATASET || DEFAULT_EVENTS_DATASET);

    const [counts, series, pages, referrers, events, durations] = await Promise.all([
        context.history.getCounts(site, interval, timezone, filters),
        context.history.getSeries(site, interval, timezone, filters),
        context.analyticsEngine.getPageMetrics(site, interval, timezone, filters, limit),
        context.analyticsEngine.getReferrersGrouped(site, interval, timezone, filters, limit * 2),
        eventsApi.getEventCounts(site, interval, timezone, undefined, limit),
        eventsApi.getDurationByPath(site, interval, timezone, limit),
    ]);
    const dimensionRows = await Promise.all(
        DIMENSIONS.map((dimension) => context.history.getAllCountsByColumn(site, dimension, interval, timezone, filters, 1, limit)),
    );

    const dimensions = Object.fromEntries(DIMENSIONS.map((dimension, index) => [
        dimension,
        dimensionRows[index].map(([value, visitors, views]: [string, number, number]) => ({ value, visitors, views })),
    ]));
    const pageData = pages.map((page: {
        path: string;
        visitors: number;
        views: number;
        entries: number;
        bounceRate: number | null;
    }) => ({
        ...page,
        avgDurationSeconds: durations.get(page.path)?.avgSeconds ?? null,
        durationSamples: durations.get(page.path)?.samples ?? 0,
    }));
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
            source: counts.source,
            truncated: counts.truncated || series.truncated,
            summary: {
                ...counts.data,
                bounceRate: counts.data.visitors ? counts.data.bounces / counts.data.visitors : null,
                avgDurationSeconds: durationSamples ? durationTotal / durationSamples : null,
                durationSamples,
            },
            series: series.data,
            pages: pageData,
            referrers,
            events: events.map(([name, count, value, type]) => ({ name, type, count, value })),
            dimensions,
        },
    });
}
