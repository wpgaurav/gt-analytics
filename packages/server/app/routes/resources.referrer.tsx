import { useEffect } from "react";
import { useFetcher } from "react-router";

import type { LoaderFunctionArgs } from "react-router";

import { paramsFromUrl, getFiltersFromSearchParams } from "~/lib/utils";
import { SearchFilters } from "~/lib/types";
import { requireApiAuth } from "~/lib/api-auth";
import Icon from "~/components/Icon";
import { absoluteUrl, displayUrl, sourceName } from "~/lib/sources";

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireApiAuth(request, context.cloudflare.env);
    const { analyticsEngine } = context;

    const { interval, site } = paramsFromUrl(request.url);
    const url = new URL(request.url);
    const tz = url.searchParams.get("timezone") || "UTC";
    const filters = getFiltersFromSearchParams(url.searchParams);

    const byHost = await analyticsEngine.getReferrersGrouped(
        site,
        interval,
        tz,
        filters,
    );

    return { groups: groupBySource(byHost) };
}

/**
 * Regroups host-level rows under their display name.
 *
 * Grouping by hostname alone still split a single brand across rows:
 * bing.com and cn.bing.com both label as "Bing", and chatgpt.com and
 * chat.openai.com are both ChatGPT. The name is what a reader treats as the
 * source, so it is the right grouping key -- and the parent count stays the
 * true sum of its children.
 */
function groupBySource(
    byHost: {
        host: string;
        views: number;
        visitors: number;
        urls: { url: string; views: number; visitors: number }[];
    }[],
): Group[] {
    const bySource = new Map<string, Group>();

    for (const row of byHost) {
        const name = sourceName(row.host);
        let group = bySource.get(name);
        if (!group) {
            group = { host: row.host, name, views: 0, visitors: 0, urls: [] };
            bySource.set(name, group);
        }

        group.views += row.views;
        group.visitors += row.visitors;

        for (const item of row.urls) {
            // Merge URLs that read identically -- "https://chatgpt.com" and
            // "https://chatgpt.com/" are the same page, and listing both is
            // noise, not precision.
            const key = displayUrl(item.url);
            const existing = group.urls.find((u) => displayUrl(u.url) === key);
            if (existing) {
                existing.views += item.views;
                existing.visitors += item.visitors;
            } else {
                group.urls.push({ ...item });
            }
        }
    }

    for (const group of bySource.values()) {
        group.urls.sort((a, b) => b.views - a.views);
    }

    return [...bySource.values()].sort((a, b) => b.views - a.views);
}

interface Group {
    /** A representative host, used for filtering and the favicon. */
    host: string;
    /** Display name -- the grouping key. */
    name: string;
    views: number;
    visitors: number;
    urls: { url: string; views: number; visitors: number }[];
}

/**
 * Referrers grouped by source.
 *
 * chatgpt.com and www.chatgpt.com are one source to anyone reading a report,
 * so they collapse into a single row whose count is the sum of its children,
 * with the exact URLs available underneath.
 */
export const ReferrerCard = ({
    siteId,
    interval,
    filters,
    onFilterChange,
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
            { site: siteId, interval, timezone, ...filters },
            { method: "get", action: "/resources/referrer" },
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [siteId, interval, filters, timezone]);

    const groups: Group[] = fetcher.data?.groups ?? [];
    const isLoading = fetcher.state === "loading";
    const formatter = Intl.NumberFormat("en", { notation: "compact" });

    return (
        <section className={`card${isLoading ? " is-busy" : ""}`}>
            <header className="card-head">
                <h2>
                    <Icon name="link" size={14} className="icon--inline" />{" "}
                    Referrers
                </h2>
                {isLoading && <span className="is-loading">Loading…</span>}
            </header>
            <div className="card-body card-body--flush">
                {groups.length === 0 ? (
                    <div className="empty-state">
                        <p>No referrals in this period.</p>
                    </div>
                ) : (
                    <div className="table-wrap">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th className="col-main">Source</th>
                                    <th className="num">Visitors</th>
                                    <th className="num">Views</th>
                                </tr>
                            </thead>
                            <tbody>
                                {groups.map((group) => (
                                    <tr key={group.name}>
                                        <td className="col-main">
                                            <SourceCell
                                                group={group}
                                                formatter={formatter}
                                                onFilter={() =>
                                                    onFilterChange({
                                                        ...filters,
                                                        referrerHost:
                                                            group.host,
                                                    })
                                                }
                                                onFilterUrl={(url) =>
                                                    onFilterChange({
                                                        ...filters,
                                                        referrer: url,
                                                    })
                                                }
                                            />
                                        </td>
                                        <td className="num">
                                            {formatter.format(group.visitors)}
                                        </td>
                                        <td className="num">
                                            {formatter.format(group.views)}
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

function SourceCell({
    group,
    formatter,
    onFilter,
    onFilterUrl,
}: {
    group: Group;
    formatter: Intl.NumberFormat;
    onFilter: () => void;
    onFilterUrl: (url: string) => void;
}) {
    const label = group.name;
    const favicon = `/favicon?url=${encodeURIComponent(
        absoluteUrl(group.urls[0]?.url) || `https://${group.host}`,
    )}`;

    // One URL under a source needs no expander -- it would just restate the
    // row one level down.
    if (group.urls.length <= 1) {
        const href = absoluteUrl(group.urls[0]?.url);
        return (
            <span className="row-label__content">
                <Favicon src={favicon} />
                <button
                    type="button"
                    className="row-label__filter"
                    onClick={onFilter}
                    title="Filter by this source"
                >
                    {label}
                </button>
                {href && (
                    <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="row-label__open"
                        aria-label={`Open ${href}`}
                    >
                        <Icon name="arrow-up-right-from-square" size={12} />
                    </a>
                )}
            </span>
        );
    }

    return (
        <details className="source">
            <summary className="source__summary">
                <span className="source__caret" aria-hidden="true" />
                <Favicon src={favicon} />
                <span className="source__name">{label}</span>
                <span className="source__count">
                    {group.urls.length} URLs
                </span>
            </summary>
            <ul className="source__urls">
                {group.urls.map((item) => {
                    const href = absoluteUrl(item.url);
                    return (
                        <li key={item.url}>
                            {/* Clicking a source narrows the dashboard to it.
                                Leaving the site is the rarer intent, so it
                                gets the small icon rather than the whole row
                                -- the same split the group row and the pages
                                table already use. */}
                            <span className="source__url-label">
                                <button
                                    type="button"
                                    className="source__url"
                                    onClick={() => onFilterUrl(item.url)}
                                    title={`Filter by ${displayUrl(item.url)}`}
                                >
                                    {displayUrl(item.url)}
                                </button>
                                {href && (
                                    <a
                                        href={href}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="row-label__open"
                                        aria-label={`Open ${href} in a new tab`}
                                    >
                                        <Icon
                                            name="arrow-up-right-from-square"
                                            size={11}
                                        />
                                    </a>
                                )}
                            </span>
                            <span className="source__url-count">
                                {formatter.format(item.visitors)} /{" "}
                                {formatter.format(item.views)}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </details>
    );
}

function Favicon({ src }: { src: string }) {
    return (
        <img
            src={src}
            alt=""
            className="row-label__icon"
            onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
            }}
        />
    );
}
