import { useFetcher } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { getFiltersFromSearchParams, paramsFromUrl } from "~/lib/utils";
import PaginatedTableCard from "~/components/PaginatedTableCard";
import { SearchFilters } from "~/lib/types";
import { requireApiAuth } from "~/lib/api-auth";

const CHANNEL_LABELS: Record<string, string> = {
    direct: "Direct",
    search: "Search",
    ai: "AI assistants",
    social: "Social",
    email: "Email",
    paid: "Paid",
    referral: "Referral",
    internal: "Internal",
};

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireApiAuth(request, context.cloudflare.env);
    const { analyticsEngine } = context;
    const { interval, site, page = 1 } = paramsFromUrl(request.url);
    const url = new URL(request.url);
    const tz = url.searchParams.get("timezone") || "UTC";
    const filters = getFiltersFromSearchParams(url.searchParams);

    return {
        countsByProperty: await analyticsEngine.getCountByChannel(
            site,
            interval,
            tz,
            filters,
            Number(page),
        ),
        page: Number(page),
    };
}

export const ChannelCard = ({
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
    return (
        <PaginatedTableCard
            siteId={siteId}
            interval={interval}
            columnHeaders={["Channel", "Visitors", "Views"]}
            dataFetcher={useFetcher<typeof loader>()}
            loaderUrl="/resources/channel"
            filters={filters}
            onClick={(channel) => onFilterChange({ ...filters, channel })}
            timezone={timezone}
            labelFormatter={(label) => CHANNEL_LABELS[label] || label}
            title="Channels"
        />
    );
};
