import { useEffect } from "react";
import { useFetcher, type LoaderFunctionArgs } from "react-router";

import { getFiltersFromSearchParams, paramsFromUrl } from "~/lib/utils";
import { SearchFilters } from "~/lib/types";
import { requireApiAuth } from "~/lib/api-auth";
import { EventsAPI } from "~/analytics/events-query";
import { DEFAULT_EVENTS_DATASET } from "~/analytics/events-dataset";
import PagesTable, { type PageRow } from "~/components/PagesTable";
import Icon from "~/components/Icon";

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireApiAuth(request, context.cloudflare.env);

    const env = context.cloudflare.env;
    const { analyticsEngine } = context;
    const { interval, site } = paramsFromUrl(request.url);
    const url = new URL(request.url);
    const tz = url.searchParams.get("timezone") || "UTC";
    const limit = Number(url.searchParams.get("limit")) || 10;
    const filters = getFiltersFromSearchParams(url.searchParams);

    const pages = await analyticsEngine.getPageMetrics(
        site,
        interval,
        tz,
        filters,
        limit,
    );

    // Duration lives in the events dataset. A failure there must not cost the
    // whole report -- the column simply shows as unmeasured.
    let durations = new Map<string, { avgSeconds: number; samples: number }>();
    try {
        const events = new EventsAPI(
            env.CF_ACCOUNT_ID,
            env.CF_BEARER_TOKEN,
            env.CF_EVENTS_DATASET || DEFAULT_EVENTS_DATASET,
        );
        durations = await events.getDurationByPath(site, interval, tz);
    } catch (error) {
        console.error("duration lookup failed", error);
    }

    const rows: PageRow[] = (pages as PageRow[]).map((page) => ({
        ...page,
        avgSeconds: durations.get(page.path)?.avgSeconds,
    }));

    return { rows };
}

export const PagesCard = ({
    siteId,
    interval,
    filters,
    onFilterChange,
    timezone,
    baseUrl,
}: {
    siteId: string;
    interval: string;
    filters: SearchFilters;
    onFilterChange: (filters: SearchFilters) => void;
    timezone: string;
    baseUrl?: string | null;
}) => {
    const fetcher = useFetcher<typeof loader>();

    useEffect(() => {
        fetcher.submit(
            { site: siteId, interval, timezone, limit: 10, ...filters },
            { method: "get", action: "/resources/pages" },
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [siteId, interval, filters, timezone]);

    const rows = fetcher.data?.rows ?? [];
    const isLoading = fetcher.state === "loading";

    return (
        <section className={`card${isLoading ? " is-busy" : ""}`}>
            <header className="card-head">
                <h2>
                    <Icon name="file-lines" size={14} className="icon--inline" />{" "}
                    Pages
                </h2>
                <a className="card-head__link" href={`/pages?site=${encodeURIComponent(siteId)}&interval=${interval}`}>
                    All pages
                </a>
            </header>
            <div className="card-body card-body--flush">
                <PagesTable
                    rows={rows}
                    baseUrl={baseUrl}
                    onFilter={(path) => onFilterChange({ ...filters, path })}
                />
            </div>
        </section>
    );
};
