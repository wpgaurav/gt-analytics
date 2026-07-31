import { useEffect, useState } from "react";
import TableCard from "~/components/TableCard";

import PaginationButtons from "./PaginationButtons";
import { SearchFilters } from "~/lib/types";

interface PaginatedTableCardProps {
    siteId: string;
    interval: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dataFetcher: any;
    columnHeaders: string[];
    filters?: SearchFilters;
    loaderUrl: string;
    onClick?: (key: string) => void;
    timezone?: string;
    labelFormatter?: (label: string) => string;
    linkBuilder?: (key: string) => string | null;
    title?: string;
}

const PaginatedTableCard = ({
    siteId,
    interval,
    dataFetcher,
    columnHeaders,
    filters,
    loaderUrl,
    onClick,
    timezone,
    labelFormatter,
    linkBuilder,
    title,
}: PaginatedTableCardProps) => {
    const countsByProperty = dataFetcher.data?.countsByProperty || [];
    const [page, setPage] = useState(1);

    useEffect(() => {
        const params = {
            site: siteId,
            interval,
            timezone,
            ...filters,
            page,
        };

        dataFetcher.submit(params, {
            method: "get",
            action: loaderUrl,
        });
        // NOTE: dataFetcher is intentionally omitted from the useEffect dependency array
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loaderUrl, siteId, interval, filters, timezone, page]);

    function handlePagination(page: number) {
        setPage(page);
    }

    const isLoading = dataFetcher.state === "loading";
    const hasMore = countsByProperty.length === 10;

    return (
        <section className={`card${isLoading ? " is-busy" : ""}`}>
            {title && (
                <header className="card-head">
                    <h2>{title}</h2>
                    {isLoading && <span className="is-loading">Loading…</span>}
                </header>
            )}
            <div className="card-body card-body--flush">
                <TableCard
                    countByProperty={countsByProperty}
                    columnHeaders={columnHeaders}
                    onClick={onClick}
                    labelFormatter={labelFormatter}
                    linkBuilder={linkBuilder}
                />
                <PaginationButtons
                    page={page}
                    hasMore={hasMore}
                    handlePagination={handlePagination}
                />
            </div>
        </section>
    );
};

export default PaginatedTableCard;
