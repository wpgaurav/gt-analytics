type CountByProperty = [string, string, string?][];

/**
 * Share of the visible rows, used to draw the inline bar behind each label.
 * Relative to what is on screen, not to the site total -- these tables are
 * paginated top-N, so a page-relative bar is the honest comparison.
 */
function calculateCountPercentages(countByProperty: CountByProperty): number[] {
    const totalCount = countByProperty.reduce(
        (sum, row) => sum + parseInt(row[1]),
        0,
    );

    if (!totalCount) return countByProperty.map(() => 0);

    return countByProperty.map((row) => parseInt(row[1]) / totalCount);
}

export interface TableCardProps {
    countByProperty: CountByProperty;
    columnHeaders: string[];
    /** Applies the row as a dashboard filter. */
    onClick?: (key: string) => void;
    labelFormatter?: (label: string) => string;
    /**
     * Turns a row key into an absolute URL. Rows that resolve to one get an
     * open-in-new-tab affordance next to the label, so a path in the report
     * can be opened on the live site in one click.
     */
    linkBuilder?: (key: string) => string | null;
}

export default function TableCard({
    countByProperty,
    columnHeaders,
    onClick,
    labelFormatter,
    linkBuilder,
}: TableCardProps) {
    const shares = calculateCountPercentages(countByProperty);
    const countFormatter = Intl.NumberFormat("en", { notation: "compact" });
    const headers = columnHeaders || [];

    if (!countByProperty || countByProperty.length === 0) {
        return (
            <div className="empty-state">
                <p>No data for this period.</p>
            </div>
        );
    }

    return (
        <div className="table-wrap">
            <table className="data-table">
                <thead>
                    <tr>
                        {headers.map((header, index) => (
                            <th
                                key={header}
                                className={index === 0 ? "col-main" : "num"}
                                scope="col"
                            >
                                {header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {countByProperty.map((item, index) => {
                        const desc = item[0];

                        // The description is either a plain string (key and
                        // label in one) or a [key, label] tuple.
                        const [key, label] = Array.isArray(desc)
                            ? [desc[0], desc[1] || "(unknown)"]
                            : [desc, desc || "(unknown)"];

                        const formattedLabel =
                            labelFormatter && typeof label === "string"
                                ? labelFormatter(label)
                                : label;

                        const isExternalUrl = /^https?:\/\//.test(String(label));
                        const href = isExternalUrl
                            ? String(label)
                            : linkBuilder?.(String(key)) || null;

                        return (
                            <tr key={String(key)}>
                                <td className="col-main">
                                    <div className="row-label">
                                        <span
                                            className="row-label__bar"
                                            style={
                                                {
                                                    "--pct": shares[index],
                                                } as React.CSSProperties
                                            }
                                            aria-hidden="true"
                                        />
                                        <span className="row-label__content">
                                            {isExternalUrl && (
                                                <img
                                                    src={`/favicon?url=${encodeURIComponent(String(label))}`}
                                                    alt=""
                                                    className="row-label__icon"
                                                    onError={(e) => {
                                                        (
                                                            e.target as HTMLImageElement
                                                        ).style.display = "none";
                                                    }}
                                                />
                                            )}

                                            {onClick ? (
                                                <button
                                                    type="button"
                                                    className="row-label__filter"
                                                    onClick={() =>
                                                        onClick(String(key))
                                                    }
                                                    title="Filter by this value"
                                                >
                                                    {formattedLabel}
                                                </button>
                                            ) : (
                                                <span className="truncate">
                                                    {formattedLabel}
                                                </span>
                                            )}

                                            {href && (
                                                <a
                                                    href={href}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="row-label__open"
                                                    title={`Open ${href}`}
                                                    aria-label={`Open ${formattedLabel} in a new tab`}
                                                >
                                                    <OpenIcon />
                                                </a>
                                            )}
                                        </span>
                                    </div>
                                </td>

                                <td className="num">
                                    {countFormatter.format(parseInt(item[1], 10))}
                                </td>

                                {item.length > 2 && item[2] !== undefined && (
                                    <td className="num">
                                        {countFormatter.format(
                                            parseInt(item[2], 10),
                                        )}
                                    </td>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function OpenIcon() {
    return (
        <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
    );
}
