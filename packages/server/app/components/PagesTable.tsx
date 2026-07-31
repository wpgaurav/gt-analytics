import Icon from "./Icon";

export interface PageRow {
    path: string;
    visitors: number;
    views: number;
    entries: number;
    bounceRate: number | null;
    avgSeconds?: number;
}

export interface PagesTableProps {
    rows: PageRow[];
    /** Site origin, so a path can be opened on the live site. */
    baseUrl?: string | null;
    onFilter?: (path: string) => void;
    dense?: boolean;
}

/**
 * Pages with their engagement metrics.
 *
 * Duration and bounce rate can legitimately be absent -- duration is only
 * collected from the point engagement tracking shipped, and bounce needs the
 * session's entry path. Both render as an em dash rather than 0, because a
 * zero here would read as "nobody stayed" instead of "not measured".
 */
export default function PagesTable({
    rows,
    baseUrl,
    onFilter,
    dense,
}: PagesTableProps) {
    const number = Intl.NumberFormat("en", { notation: "compact" });

    if (rows.length === 0) {
        return (
            <div className="empty-state">
                <p>No pageviews in this period.</p>
            </div>
        );
    }

    return (
        <div className="table-wrap">
            <table className={dense ? "data-table data-table--dense" : "data-table"}>
                <thead>
                    <tr>
                        <th className="col-main">Page</th>
                        <th className="num">Visitors</th>
                        <th className="num">Views</th>
                        <th className="num">Avg. time</th>
                        <th className="num">Bounce</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => {
                        const href =
                            baseUrl && row.path.startsWith("/")
                                ? `${baseUrl}${row.path}`
                                : null;

                        return (
                            <tr key={row.path}>
                                <td className="col-main">
                                    <span className="row-label__content">
                                        {onFilter ? (
                                            <button
                                                type="button"
                                                className="row-label__filter"
                                                onClick={() =>
                                                    onFilter(row.path)
                                                }
                                                title="Filter by this page"
                                            >
                                                {row.path}
                                            </button>
                                        ) : (
                                            <span className="truncate">
                                                {row.path}
                                            </span>
                                        )}
                                        {href && (
                                            <a
                                                href={href}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="row-label__open"
                                                aria-label={`Open ${row.path}`}
                                            >
                                                <Icon
                                                    name="arrow-up-right-from-square"
                                                    size={12}
                                                />
                                            </a>
                                        )}
                                    </span>
                                </td>
                                <td className="num">
                                    {number.format(row.visitors)}
                                </td>
                                <td className="num">
                                    {number.format(row.views)}
                                </td>
                                <td className="num">
                                    {formatDuration(row.avgSeconds)}
                                </td>
                                <td className="num">
                                    {formatRate(row.bounceRate)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

/** m:ss up to an hour, then h:mm. */
export function formatDuration(seconds?: number): string {
    if (seconds === undefined || seconds === null || !isFinite(seconds)) {
        return "—";
    }
    const total = Math.round(seconds);
    if (total < 60) return `${total}s`;

    const minutes = Math.floor(total / 60);
    if (minutes < 60) {
        return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
    }
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatRate(rate: number | null | undefined): string {
    if (rate === null || rate === undefined || !isFinite(rate)) return "—";
    return `${Math.round(rate * 100)}%`;
}
