import { useFetcher } from "react-router";

import type { LoaderFunctionArgs } from "react-router";

import {
    getFiltersFromSearchParams as getFiltersFromSearchParams,
    paramsFromUrl,
} from "~/lib/utils";
import PaginatedTableCard from "~/components/PaginatedTableCard";
import { SearchFilters } from "~/lib/types";
import { requireApiAuth } from "~/lib/api-auth";

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireApiAuth(request, context.cloudflare.env);
    const { analyticsEngine } = context;

    const { interval, site, page = 1 } = paramsFromUrl(request.url);

    const url = new URL(request.url);
    const tz = url.searchParams.get("timezone") || "UTC";
    const filters = getFiltersFromSearchParams(url.searchParams);

    return {
        countsByProperty: await analyticsEngine.getCountByPath(
            site,
            interval,
            tz,
            filters,
            Number(page),
        ),
        page: Number(page),
    };
}

export const PathsCard = ({
    siteId,
    interval,
    filters,
    onFilterChange,
    timezone,
    linkBuilder,
}: {
    siteId: string;
    interval: string;
    filters: SearchFilters;
    onFilterChange: (filters: SearchFilters) => void;
    timezone: string;
    /** Turns a recorded path into an absolute URL on the live site. */
    linkBuilder?: (key: string) => string | null;
}) => {
    return (
        <PaginatedTableCard
            siteId={siteId}
            interval={interval}
            columnHeaders={["Path", "Visitors", "Views"]}
            dataFetcher={useFetcher<typeof loader>()}
            filters={filters}
            loaderUrl="/resources/paths"
            onClick={(path) => onFilterChange({ ...filters, path })}
            timezone={timezone}
            linkBuilder={linkBuilder}
            title="Pages"
        />
    );
};
