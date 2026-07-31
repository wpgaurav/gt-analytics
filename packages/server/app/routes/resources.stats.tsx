import type { LoaderFunctionArgs } from "react-router";
import {
    getDateTimeRange,
    getFiltersFromSearchParams,
    paramsFromUrl,
} from "~/lib/utils";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { SearchFilters } from "~/lib/types";
import { requireApiAuth } from "~/lib/api-auth";

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireApiAuth(request, context.cloudflare.env);
    const { analyticsEngine, history } = context;
    const { interval, site } = paramsFromUrl(request.url);
    const url = new URL(request.url);
    const tz = url.searchParams.get("timezone") || "UTC";
    const filters = getFiltersFromSearchParams(url.searchParams);

    // intentionally parallelize queries by deferring await
    const earliestEvents = analyticsEngine.getEarliestEvents(site);
    // Routed rather than read straight from Analytics Engine: for a range
    // older than retention, or older than a migrated site's cutover date, the
    // archive is where the numbers actually are.
    const { data: counts, source } = await history.getCounts(
        site,
        interval,
        tz,
        filters,
    );

    const { earliestEvent, earliestBounce } = await earliestEvents;
    const { startDate } = getDateTimeRange(interval, tz);

    // FOR BACKWARDS COMPAT, ONLY SHOW BOUNCE RATE IF WE HAVE DATE FOR THE ENTIRE QUERY PERIOD
    // -----------------------------------------------------------------------------
    // Bounce rate is a later-introduced metric that may not have been recorded for
    // the full duration of the queried Counterscale dataset (not possible to backfill
    // data we dont have!)

    // So, cannot reliably show "bounce rate" if bounce data was unavailable for a portion
    // of the query period.

    // To figure out if we can give an answer or not, we inspect the earliest bounce/earliest event
    // data recorded, and determine if our dataset is "complete" for the given query interval.

    const hasSufficientBounceData =
        earliestBounce !== null &&
        earliestEvent !== null &&
        (earliestEvent.getTime() == earliestBounce.getTime() || // earliest event recorded a bounce -- any query is fine
            earliestBounce < startDate); // earliest bounce occurred before start of query period -- this query is fine

    const bounceRate =
        counts.visitors > 0 ? counts.bounces / counts.visitors : undefined;

    return {
        views: counts.views,
        visitors: counts.visitors,
        bounceRate: bounceRate,
        // Archived days carry a bounce total but no earliest-bounce marker to
        // check it against, so the completeness test above only applies to
        // days Analytics Engine answered.
        hasSufficientBounceData:
            source === "ae" ? hasSufficientBounceData : counts.bounces > 0,
    };
}

export const StatsCard = ({
    siteId,
    interval,
    filters,
    timezone,
}: {
    siteId: string;
    interval: string;
    filters: SearchFilters;
    timezone: string;
}) => {
    const dataFetcher = useFetcher<typeof loader>();

    const { views, visitors, bounceRate, hasSufficientBounceData } =
        dataFetcher.data || {};
    const countFormatter = Intl.NumberFormat("en", { notation: "compact" });

    useEffect(() => {
        const params = {
            site: siteId,
            interval,
            timezone,
            ...filters,
        };

        dataFetcher.submit(params, {
            method: "get",
            action: `/resources/stats`,
        });
        // NOTE: dataFetcher is intentionally omitted from the useEffect dependency array
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [siteId, interval, filters, timezone]);

    return (
        <section className="card">
            <div className="card-body">
                <div className="kpis">
                    <div className="kpi kpi--primary">
                        <span className="kpi__value">
                            {visitors ? countFormatter.format(visitors) : "—"}
                        </span>
                        <span className="kpi__label">Visitors</span>
                    </div>
                    <div className="kpi">
                        <span className="kpi__value">
                            {views ? countFormatter.format(views) : "—"}
                        </span>
                        <span className="kpi__label">Views</span>
                    </div>
                    <div className="kpi">
                        <span className="kpi__value">
                            {hasSufficientBounceData
                                ? bounceRate !== undefined
                                    ? `${Math.round(bounceRate * 100)}%`
                                    : "—"
                                : "n/a"}
                        </span>
                        <span className="kpi__label">Bounce rate</span>
                    </div>
                </div>
            </div>
        </section>
    );
};
