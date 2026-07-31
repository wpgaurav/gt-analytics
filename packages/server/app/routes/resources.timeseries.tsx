import type { LoaderFunctionArgs } from "react-router";
import {
    getFiltersFromSearchParams,
    paramsFromUrl,
    getIntervalType,
    getDateTimeRange,
} from "~/lib/utils";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import TimeSeriesChart from "~/components/TimeSeriesChart";
import { SearchFilters } from "~/lib/types";
import { requireApiAuth } from "~/lib/api-auth";
import type { ViewsGroupedByInterval } from "~/analytics/query";

export async function loader({
    context,
    request,
}: LoaderFunctionArgs) {
    await requireApiAuth(request, context.cloudflare.env);

    const { analyticsEngine } = context;
    const { interval, site } = paramsFromUrl(request.url);
    const url = new URL(request.url);
    const tz = url.searchParams.get("timezone") || "UTC";
    const filters = getFiltersFromSearchParams(url.searchParams);

    const intervalType = getIntervalType(interval);
    const { startDate, endDate } = getDateTimeRange(interval, tz);

    const viewsGroupedByInterval: ViewsGroupedByInterval =
        await analyticsEngine.getViewsGroupedByInterval(
            site,
            intervalType,
            startDate,
            endDate,
            tz,
            filters,
        );

    const chartData: {
        date: string;
        views: number;
        visitors: number;
        bounceRate: number;
    }[] = [];
    viewsGroupedByInterval.forEach((row) => {
        const { views, visitors, bounces } = row[1];

        chartData.push({
            date: row[0],
            views,
            visitors,
            bounceRate: Math.floor(
                (visitors > 0 ? bounces / visitors : 0) * 100,
            ),
        });
    });

    return {
        chartData: chartData,
        intervalType: intervalType,
    };
}

export const TimeSeriesCard = ({
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
    const { chartData, intervalType } = dataFetcher.data || {};

    useEffect(() => {
        const params = {
            site: siteId,
            interval,
            timezone,
            ...filters,
        };

        dataFetcher.submit(params, {
            method: "get",
            action: `/resources/timeseries`,
        });
        // NOTE: dataFetcher is intentionally omitted from the useEffect dependency array
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [siteId, interval, filters, timezone]);

    return (
        <section className="card">
            <div className="card-body chart-body">
                {chartData && (
                    <TimeSeriesChart
                        data={chartData}
                        intervalType={intervalType}
                    />
                )}
            </div>
        </section>
    );
};
