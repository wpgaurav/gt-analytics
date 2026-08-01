import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { getFiltersFromSearchParams, paramsFromUrl } from "~/lib/utils";
import { SearchFilters } from "~/lib/types";
import { requireApiAuth } from "~/lib/api-auth";
import { EventsAPI } from "~/analytics/events-query";
import { DEFAULT_EVENTS_DATASET } from "~/analytics/events-dataset";
import Icon from "~/components/Icon";

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireApiAuth(request, context.cloudflare.env);

    const env = context.cloudflare.env;
    const { interval, site } = paramsFromUrl(request.url);
    const url = new URL(request.url);
    const tz = url.searchParams.get("timezone") || "UTC";
    const filters = getFiltersFromSearchParams(url.searchParams);

    const api = new EventsAPI(
        env.CF_ACCOUNT_ID,
        env.CF_BEARER_TOKEN,
        env.CF_EVENTS_DATASET || DEFAULT_EVENTS_DATASET,
    );

    let rows: [string, number, number, string][] = [];
    let details: Awaited<ReturnType<EventsAPI["getEventBreakdown"]>> = [];
    try {
        [rows, details] = await Promise.all([
            api.getEventCounts(site, interval, tz, "conversion", 20, filters),
            api.getEventBreakdown(
                site,
                interval,
                tz,
                "conversion",
                500,
                filters,
            ),
        ]);
    } catch (err) {
        // An events dataset that has never been written to does not exist yet,
        // and querying it errors. That is the normal state before the first
        // conversion fires, so it must not take the dashboard down.
        console.error("events query failed", err);
    }

    return { rows, details };
}

export const ConversionsCard = ({
    siteId,
    interval,
    filters,
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
            { site: siteId, interval, timezone, ...filters },
            { method: "get", action: "/resources/conversions" },
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [siteId, interval, filters, timezone]);

    const rows = fetcher.data?.rows ?? [];
    const details = fetcher.data?.details ?? [];
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
                            <a href="/admin/settings">Install &amp; tracking</a>
                            .
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
                                            <ConversionDetails
                                                name={name}
                                                rows={details.filter(
                                                    (detail) =>
                                                        detail.name === name &&
                                                        detail.type === type,
                                                )}
                                                baseUrl={baseUrl}
                                                formatter={countFormatter}
                                            />
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

function ConversionDetails({
    name,
    rows,
    baseUrl,
    formatter,
}: {
    name: string;
    rows: Awaited<ReturnType<EventsAPI["getEventBreakdown"]>>;
    baseUrl?: string | null;
    formatter: Intl.NumberFormat;
}) {
    return (
        <details className="conversion-detail">
            <summary className="conversion-detail__summary">
                <span className="source__caret" aria-hidden="true" />
                <span className="source__name truncate">{name}</span>
                <span className="pill pill--brand">Goal</span>
            </summary>
            <ul className="conversion-detail__list">
                {rows.map((row, index) => {
                    const pageUrl = conversionPageUrl(baseUrl, row.path);
                    const title =
                        row.label || row.path || "Unlabelled conversion";
                    const attribution = [
                        row.channel,
                        row.referrerHost,
                        row.utmCampaign && `campaign: ${row.utmCampaign}`,
                        row.utmSource && `source: ${row.utmSource}`,
                        row.utmMedium && `medium: ${row.utmMedium}`,
                        row.country,
                    ].filter(Boolean);
                    const formattedValue = row.value
                        ? `${formatter.format(row.value)}${row.currency ? ` ${row.currency}` : ""}`
                        : "";

                    return (
                        <li
                            key={`${row.path}:${row.label}:${row.channel}:${index}`}
                        >
                            <span className="conversion-detail__context">
                                <strong>{title}</strong>
                                <small>
                                    {row.path || "/"}
                                    {pageUrl && (
                                        <a
                                            href={pageUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="row-label__open"
                                            aria-label={`Open ${pageUrl} in a new tab`}
                                        >
                                            <Icon
                                                name="arrow-up-right-from-square"
                                                size={11}
                                            />
                                        </a>
                                    )}
                                    {attribution.length > 0 &&
                                        ` · ${attribution.join(" · ")}`}
                                </small>
                            </span>
                            <span className="conversion-detail__totals">
                                <strong>{formatter.format(row.count)}</strong>
                                {formattedValue && (
                                    <small>{formattedValue}</small>
                                )}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </details>
    );
}

function conversionPageUrl(baseUrl: string | null | undefined, path: string) {
    if (!baseUrl || !path) return "";
    try {
        return new URL(path, baseUrl).toString();
    } catch {
        return "";
    }
}
