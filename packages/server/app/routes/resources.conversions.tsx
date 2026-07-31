import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { paramsFromUrl } from "~/lib/utils";
import { SearchFilters } from "~/lib/types";
import { requireApiAuth } from "~/lib/api-auth";
import { EventsAPI } from "~/analytics/events-query";
import { DEFAULT_EVENTS_DATASET } from "~/analytics/events-dataset";

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireApiAuth(request, context.cloudflare.env);

    const env = context.cloudflare.env;
    const { interval, site } = paramsFromUrl(request.url);
    const url = new URL(request.url);
    const tz = url.searchParams.get("timezone") || "UTC";

    const api = new EventsAPI(
        env.CF_ACCOUNT_ID,
        env.CF_BEARER_TOKEN,
        env.CF_EVENTS_DATASET || DEFAULT_EVENTS_DATASET,
    );

    let rows: [string, number, number, string][] = [];
    try {
        rows = await api.getEventCounts(site, interval, tz);
    } catch (err) {
        // An events dataset that has never been written to does not exist yet,
        // and querying it errors. That is the normal state before the first
        // conversion fires, so it must not take the dashboard down.
        console.error("events query failed", err);
    }

    return { rows };
}

export const ConversionsCard = ({
    siteId,
    interval,
    timezone,
}: {
    siteId: string;
    interval: string;
    filters: SearchFilters;
    onFilterChange: (filters: SearchFilters) => void;
    timezone: string;
}) => {
    const fetcher = useFetcher<typeof loader>();

    useEffect(() => {
        fetcher.submit(
            { site: siteId, interval, timezone },
            { method: "get", action: "/resources/conversions" },
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [siteId, interval, timezone]);

    const rows = fetcher.data?.rows ?? [];
    const isLoading = fetcher.state === "loading";
    const countFormatter = Intl.NumberFormat("en", { notation: "compact" });

    return (
        <section className={`card${isLoading ? " is-busy" : ""}`}>
            <header className="card-head">
                <h2>Conversions</h2>
                {isLoading && <span className="is-loading">Loading…</span>}
            </header>
            <div className="card-body card-body--flush">
                {rows.length === 0 ? (
                    <div className="empty-state">
                        <p>
                            No conversions recorded. Add a{" "}
                            <code>gta(&apos;conversion&apos;, …)</code> call to
                            start counting — see{" "}
                            <a href="/admin/settings">Install &amp; tracking</a>.
                        </p>
                    </div>
                ) : (
                    <div className="table-wrap">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th className="col-main">Event</th>
                                    <th className="num">Count</th>
                                    <th className="num">Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(([name, count, value, type]) => (
                                    <tr key={`${type}:${name}`}>
                                        <td className="col-main">
                                            <div className="row-label">
                                                <span className="row-label__content">
                                                    <span className="truncate">
                                                        {name}
                                                    </span>
                                                    {type === "conversion" && (
                                                        <span className="pill pill--brand">
                                                            Goal
                                                        </span>
                                                    )}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="num">
                                            {countFormatter.format(count)}
                                        </td>
                                        <td className="num">
                                            {value
                                                ? countFormatter.format(value)
                                                : "—"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </section>
    );
};
