import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import {
    isRouteErrorResponse,
    redirect,
    useLoaderData,
    useNavigation,
    useRouteError,
    useSearchParams,
} from "react-router";

import { ReferrerCard } from "./resources.referrer";
import { ChannelCard } from "./resources.channel";
import { PagesCard } from "./resources.pages";
import { BrowserCard } from "./resources.browser";
import { BrowserVersionCard } from "./resources.browserversion";
import { CountryCard } from "./resources.country";
import { DeviceCard } from "./resources.device";
import { UtmSourceCard } from "./resources.utm-source";
import { UtmMediumCard } from "./resources.utm-medium";
import { UtmCampaignCard } from "./resources.utm-campaign";
import { UtmTermCard } from "./resources.utm-term";
import { UtmContentCard } from "./resources.utm-content";

import {
    getFiltersFromSearchParams,
    getIntervalType,
    getUserTimezone,
} from "~/lib/utils";
import { SearchFilters } from "~/lib/types";
import SearchFilterBadges from "~/components/SearchFilterBadges";
import RangePicker from "~/components/RangePicker";
import { TimeSeriesCard } from "./resources.timeseries";
import { StatsCard } from "./resources.stats";
import { ConversionsCard } from "./resources.conversions";
import { requireAuth } from "~/lib/auth";
import { listSiteUrls, listSites } from "~/sites/sites";
import {
    choosePreferredSite,
    SITE_COOKIE_NAME,
} from "~/lib/site-preference";

export const meta: MetaFunction = () => {
    return [
        { title: "Dashboard — GT Analytics" },
        { name: "description", content: "GT Analytics" },
    ];
};

/**
 * Managed site ids, or an empty list if the database is unreachable.
 *
 * Defensive on purpose: the dashboard must still render from Analytics Engine
 * alone if the sites database is missing, and a bare `.catch()` does not help
 * when it is the property access itself that throws.
 */
async function safeListSites(
    context: LoaderFunctionArgs["context"],
    accountId: string,
): Promise<string[]> {
    try {
        const db = context.cloudflare?.env?.SITES_DB;
        if (!db) return [];
        return (await listSites(db, accountId)).map((site) => site.site_id);
    } catch (error) {
        console.error("could not load managed sites", error);
        return [];
    }
}

export const loader = async ({ context, request }: LoaderFunctionArgs) => {
    const user = await requireAuth(request, context.cloudflare.env);

    // NOTE: probably duped from getLoadContext / need to de-duplicate
    if (!context.cloudflare?.env?.CF_ACCOUNT_ID) {
        throw new Response("Missing credentials: CF_ACCOUNT_ID is not set.", {
            status: 501,
        });
    }
    if (!context.cloudflare?.env?.CF_BEARER_TOKEN) {
        throw new Response("Missing credentials: CF_BEARER_TOKEN is not set.", {
            status: 501,
        });
    }
    const url = new URL(request.url);

    let interval;
    try {
        interval = url.searchParams.get("interval") || "7d";
    } catch {
        interval = "7d";
    }

    // if no siteId is set, redirect to the site with the most hits
    // during the default interval (e.g. 7d)
    if (url.searchParams.has("site") === false) {
        const known = await safeListSites(context, user.accountId!);

        // Prefer the site last looked at. Falling back to "most hits" alone
        // meant the dashboard kept opening on whichever site happened to be
        // busiest, which is rarely the one being worked on.
        const redirectSite = choosePreferredSite(
            request,
            known,
            known[0] || "",
        );
        const redirectUrl = new URL(request.url);
        redirectUrl.searchParams.set("site", redirectSite);
        throw redirect(redirectUrl.toString());
    }

    const siteId = url.searchParams.get("site") || "";
    const actualSiteId = siteId === "@unknown" ? "" : siteId;
    const managed = await safeListSites(context, user.accountId!);
    if (actualSiteId && !managed.includes(actualSiteId)) {
        throw new Response("Site not found", { status: 404 });
    }

    const filters = getFiltersFromSearchParams(url.searchParams);

    // initiate requests to AE in parallel

    // The site picker lists the sites you manage, not every site id Analytics
    // Engine has ever seen. Deriving it from hits meant one-off ids -- test
    // traffic, a mistyped snippet, an old deployment's default -- accumulated
    // in the dropdown for 90 days with no way to remove them.
    //
    const intervalType = getIntervalType(interval);

    // Base URLs come from the managed sites table, so a recorded path can be
    // turned back into a clickable link on the live site.
    let siteUrls: Record<string, string> = {};
    try {
        siteUrls = await listSiteUrls(context.cloudflare.env.SITES_DB, user.accountId!);
    } catch (err) {
        // A missing or unreachable sites database must not take the dashboard
        // down -- links simply degrade to plain text.
        console.error("could not load site base URLs", err);
    }

    // await all requests to AE then return the results

    let out;
    try {
        const sites = [...managed];

        out = {
            siteId: actualSiteId,
            sites,
            siteUrls,
            intervalType,
            interval,
            filters,
        };
    } catch (err) {
        console.error(err);
        throw new Error("Failed to fetch data from Analytics Engine");
    }

    return out;
};

export default function Dashboard() {
    const [, setSearchParams] = useSearchParams();

    const data = useLoaderData<typeof loader>();
    const navigation = useNavigation();
    const loading = navigation.state === "loading";

    function changeSite(site: string) {
        // Remember the choice so the next visit opens here. Written client
        // side because the loader only ever redirects when no site is named.
        document.cookie = `${SITE_COOKIE_NAME}=${encodeURIComponent(site)}; Path=/; Max-Age=31536000; SameSite=Lax`;

        // intentionally not updating prev params; don't want search
        // filters (e.g. referrer, path) to persist

        // TODO: might revisit if this is considered unexpected behavior
        setSearchParams({
            site,
            interval: data.interval,
        });
    }

    function changeInterval(interval: string) {
        setSearchParams((prev) => {
            prev.set("interval", interval);
            return prev;
        });
    }

    const handleFilterChange = (filters: SearchFilters) => {
        setSearchParams((prev) => {
            for (const key in filters) {
                if (Object.hasOwnProperty.call(filters, key)) {
                    prev.set(
                        key,
                        filters[key as keyof SearchFilters] as string,
                    );
                }
            }
            return prev;
        });
    };

    const handleFilterDelete = (key: string) => {
        setSearchParams((prev) => {
            prev.delete(key);
            return prev;
        });
    };

    const userTimezone = getUserTimezone();

    // Recorded paths are site-relative; the managed base URL turns them back
    // into something clickable. Sites without one (non-WordPress properties)
    // simply render as text.
    const siteBase = data.siteUrls?.[data.siteId];
    const cardProps = {
        siteId: data.siteId,
        interval: data.interval,
        filters: data.filters,
        onFilterChange: handleFilterChange,
        timezone: userTimezone,
    };

    return (
        <>
            <div className="toolbar">
                <label className="visually-hidden" htmlFor="site-picker">
                    Site
                </label>
                <select
                    id="site-picker"
                    className="select"
                    value={data.siteId || "@unknown"}
                    onChange={(e) => changeSite(e.target.value)}
                >
                    {data.sites.map((siteId: string) => (
                        <option key={`k-${siteId}`} value={siteId || "@unknown"}>
                            {siteId || "(unknown)"}
                        </option>
                    ))}
                </select>

                <RangePicker
                    value={data.interval}
                    onChange={changeInterval}
                />

                <SearchFilterBadges
                    filters={data.filters}
                    onFilterDelete={handleFilterDelete}
                />
            </div>

            <div className={loading ? "dashboard is-busy" : "dashboard"}>
                <StatsCard
                    siteId={data.siteId}
                    interval={data.interval}
                    filters={data.filters}
                    timezone={userTimezone}
                />

                <TimeSeriesCard
                    siteId={data.siteId}
                    interval={data.interval}
                    filters={data.filters}
                    timezone={userTimezone}
                />

                <div className="grid-cards grid-cards--2">
                    <PagesCard {...cardProps} baseUrl={siteBase} />
                    <ReferrerCard {...cardProps} />
                </div>

                <div className="grid-cards grid-cards--2">
                    <ChannelCard {...cardProps} />
                    <ConversionsCard {...cardProps} />
                </div>

                <div className="grid-cards grid-cards--3">
                    {data.filters && data.filters.browserName ? (
                        <BrowserVersionCard {...cardProps} />
                    ) : (
                        <BrowserCard {...cardProps} />
                    )}
                    <CountryCard {...cardProps} />
                    <DeviceCard {...cardProps} />
                </div>

                <div className="grid-cards grid-cards--3">
                    <UtmSourceCard {...cardProps} />
                    <UtmMediumCard {...cardProps} />
                    <UtmCampaignCard {...cardProps} />
                </div>

                <div className="grid-cards grid-cards--2">
                    <UtmTermCard {...cardProps} />
                    <UtmContentCard {...cardProps} />
                </div>
            </div>
        </>
    );
}

export function ErrorBoundary() {
    const error = useRouteError();
    const [searchParams] = useSearchParams();

    const siteId = searchParams.get("site");
    const interval = searchParams.get("interval") || "7d";

    let errorInfo = {
        title: "Dashboard Error",
        message: "An unexpected error occurred while loading the dashboard.",
        suggestion:
            "Please try refreshing the page or contact support if the issue persists.",
        actionable: true,
        showRetry: true,
        showContext: true,
    };

    if (isRouteErrorResponse(error)) {
        switch (error.status) {
            case 501:
                if (error.data?.includes("CF_ACCOUNT_ID")) {
                    errorInfo = {
                        title: "Configuration Error",
                        message: "Missing Cloudflare Account ID configuration.",
                        suggestion:
                            "Please ensure CF_ACCOUNT_ID is properly configured in your environment variables.",
                        actionable: false,
                        showRetry: false,
                        showContext: false,
                    };
                } else if (error.data?.includes("CF_BEARER_TOKEN")) {
                    errorInfo = {
                        title: "Configuration Error",
                        message:
                            "Missing Cloudflare Bearer Token configuration.",
                        suggestion:
                            "Please ensure CF_BEARER_TOKEN is properly configured in your environment variables.",
                        actionable: false,
                        showRetry: false,
                        showContext: false,
                    };
                } else {
                    errorInfo = {
                        title: `Configuration Error (${error.status})`,
                        message:
                            error.data || "Server configuration is incomplete.",
                        suggestion:
                            "Please check your Cloudflare Analytics Engine configuration.",
                        actionable: false,
                        showRetry: false,
                        showContext: false,
                    };
                }
                break;
            case 500:
                errorInfo = {
                    title: "Server Error",
                    message: "The server encountered an internal error.",
                    suggestion:
                        "This is likely a temporary issue. Please try again in a few moments.",
                    actionable: true,
                    showRetry: true,
                    showContext: true,
                };
                break;
            default:
                errorInfo = {
                    title: `Error ${error.status}`,
                    message:
                        error.data ||
                        error.statusText ||
                        "An HTTP error occurred.",
                    suggestion:
                        "Please try refreshing the page or contact support if the issue persists.",
                    actionable: true,
                    showRetry: true,
                    showContext: true,
                };
        }
    } else if (error instanceof Error) {
        if (error.message?.includes("Analytics Engine")) {
            errorInfo = {
                title: "Analytics Engine Error",
                message: "Failed to connect to Cloudflare Analytics Engine.",
                suggestion:
                    "This could be due to network issues or Analytics Engine being temporarily unavailable. Please try again in a few moments.",
                actionable: true,
                showRetry: true,
                showContext: true,
            };
        } else if (error.message?.includes("Authentication")) {
            errorInfo = {
                title: "Authentication Error",
                message: error.message,
                suggestion:
                    "Please check your credentials and try logging in again.",
                actionable: true,
                showRetry: false,
                showContext: false,
            };
        } else if (error.message?.includes("Invalid interval")) {
            errorInfo = {
                title: "Invalid Time Range",
                message: "The selected time interval is not supported.",
                suggestion:
                    "Please select a different time range from the dropdown.",
                actionable: true,
                showRetry: false,
                showContext: true,
            };
        } else {
            errorInfo = {
                title: "Application Error",
                message:
                    error.message ||
                    "An unexpected application error occurred.",
                suggestion:
                    "Please try refreshing the page or contact support if the issue persists.",
                actionable: true,
                showRetry: true,
                showContext: true,
            };
        }
    }

    const handleRetry = () => {
        window.location.reload();
    };

    const handleGoHome = () => {
        window.location.href = "/dashboard";
    };

    console.error("Dashboard Error:", error);

    return (
        <div className="container-narrow errorbox">
            <div className="card">
                <div className="card-body">
                    <header className="section-head errorbox__head">
                        <span className="pill pill--error">Error</span>
                        <h1>{errorInfo.title}</h1>
                        <p>{errorInfo.message}</p>
                    </header>

                    <div className="flash flash--error">
                        <strong>Suggestion:</strong> {errorInfo.suggestion}
                    </div>

                    {errorInfo.showContext && (siteId || interval !== "7d") && (
                        <>
                            <h2 className="errorbox__context-title">
                                Context when the error occurred
                            </h2>
                            <dl className="errorbox__context">
                                {siteId && (
                                    <>
                                        <dt>Site</dt>
                                        <dd className="mono">{siteId}</dd>
                                    </>
                                )}
                                <dt>Time range</dt>
                                <dd className="mono">{interval}</dd>
                            </dl>
                        </>
                    )}

                    {errorInfo.actionable && (
                        <div className="app-actions">
                            {errorInfo.showRetry && (
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={handleRetry}
                                >
                                    Try again
                                </button>
                            )}
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={handleGoHome}
                            >
                                Back to dashboard
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
