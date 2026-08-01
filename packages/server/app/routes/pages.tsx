import {
    useLoaderData,
    useSearchParams,
    type LoaderFunctionArgs,
    type MetaFunction,
} from "react-router";

import { requireAuth } from "~/lib/auth";
import { listSiteUrls, listSites, type Site } from "~/sites/sites";
import { choosePreferredSite, SITE_COOKIE_NAME } from "~/lib/site-preference";
import { EventsAPI } from "~/analytics/events-query";
import { DEFAULT_EVENTS_DATASET } from "~/analytics/events-dataset";
import PagesTable, {
    formatDuration,
    formatRate,
    type PageRow,
} from "~/components/PagesTable";
import Icon from "~/components/Icon";
import RangePicker from "~/components/RangePicker";

export const meta: MetaFunction = () => [{ title: "Pages — GT Analytics" }];

export async function loader({ context, request }: LoaderFunctionArgs) {
    const user = await requireAuth(request, context.cloudflare.env);

    const env = context.cloudflare.env;
    const { analyticsEngine } = context;
    const url = new URL(request.url);
    const interval = url.searchParams.get("interval") || "7d";
    const tz = url.searchParams.get("timezone") || "UTC";

    const sites = await listSites(env.SITES_DB, user.accountId!).catch(() => [] as Site[]);
    const siteId =
        url.searchParams.get("site") ||
        choosePreferredSite(
            request,
            sites.map((s) => s.site_id),
            sites[0]?.site_id || "",
        );
    if (siteId && !sites.some((site) => site.site_id === siteId)) {
        throw new Response("Site not found", { status: 404 });
    }

    const siteUrls = await listSiteUrls(env.SITES_DB, user.accountId!).catch(() => ({}));

    // 250 rows is well past what anyone scrolls, and keeps one query bounded.
    const pages = await analyticsEngine.getPageMetrics(
        siteId,
        interval,
        tz,
        {},
        250,
    );

    let durations = new Map<string, { avgSeconds: number; samples: number }>();
    try {
        const events = new EventsAPI(
            env.CF_ACCOUNT_ID,
            env.CF_BEARER_TOKEN,
            env.CF_EVENTS_DATASET || DEFAULT_EVENTS_DATASET,
        );
        durations = await events.getDurationByPath(siteId, interval, tz, 500);
    } catch (error) {
        console.error("duration lookup failed", error);
    }

    const rows: PageRow[] = (pages as PageRow[]).map((page) => ({
        ...page,
        avgSeconds: durations.get(page.path)?.avgSeconds,
    }));

    const totals = rows.reduce(
        (acc, row) => {
            acc.views += row.views;
            acc.visitors += row.visitors;
            if (row.avgSeconds !== undefined) {
                acc.durationSum += row.avgSeconds * row.views;
                acc.durationViews += row.views;
            }
            if (row.bounceRate !== null) {
                acc.bounceSum += row.bounceRate * row.entries;
                acc.bounceEntries += row.entries;
            }
            return acc;
        },
        {
            views: 0,
            visitors: 0,
            durationSum: 0,
            durationViews: 0,
            bounceSum: 0,
            bounceEntries: 0,
        },
    );

    return {
        rows,
        sites,
        siteId,
        interval,
        baseUrl: (siteUrls as Record<string, string>)[siteId] ?? null,
        summary: {
            pages: rows.length,
            views: totals.views,
            visitors: totals.visitors,
            // Weighted by views and entries respectively -- a flat average
            // would let a page with three views swing the site figure.
            avgSeconds: totals.durationViews
                ? totals.durationSum / totals.durationViews
                : undefined,
            bounceRate: totals.bounceEntries
                ? totals.bounceSum / totals.bounceEntries
                : null,
        },
    };
}

export default function Pages() {
    const { rows, sites, siteId, interval, baseUrl, summary } =
        useLoaderData<typeof loader>();
    const [, setSearchParams] = useSearchParams();

    function update(next: Record<string, string>) {
        setSearchParams((prev) => {
            for (const [key, value] of Object.entries(next)) {
                prev.set(key, value);
            }
            return prev;
        });
    }

    return (
        <>
            <header className="app-head">
                <div>
                    <h1>
                        <Icon
                            name="file-lines"
                            size={24}
                            className="icon--inline"
                        />{" "}
                        Pages
                    </h1>
                    <p>
                        Every page with traffic in this period, with how long
                        people stayed and how often they left without going
                        further.
                    </p>
                </div>
            </header>

            <div className="toolbar">
                <label className="visually-hidden" htmlFor="pages-site">
                    Site
                </label>
                <select
                    id="pages-site"
                    className="select"
                    value={siteId}
                    onChange={(e) => {
                        document.cookie = `${SITE_COOKIE_NAME}=${encodeURIComponent(e.target.value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
                        update({ site: e.target.value });
                    }}
                >
                    {sites.map((site: Site) => (
                        <option key={site.site_id} value={site.site_id}>
                            {site.label}
                        </option>
                    ))}
                </select>

                <RangePicker
                    value={interval}
                    onChange={(value) => update({ interval: value })}
                />
            </div>

            <div className="kpis">
                <div className="kpi kpi--primary">
                    <span className="kpi__value">
                        {summary.pages.toLocaleString()}
                    </span>
                    <span className="kpi__label">Pages with traffic</span>
                </div>
                <div className="kpi">
                    <span className="kpi__value">
                        {summary.visitors.toLocaleString()}
                    </span>
                    <span className="kpi__label">Visitors</span>
                </div>
                <div className="kpi">
                    <span className="kpi__value">
                        {summary.views.toLocaleString()}
                    </span>
                    <span className="kpi__label">Views</span>
                </div>
                <div className="kpi">
                    <span className="kpi__value">
                        {formatDuration(summary.avgSeconds)}
                    </span>
                    <span className="kpi__label">Avg. time on page</span>
                </div>
                <div className="kpi">
                    <span className="kpi__value">
                        {formatRate(summary.bounceRate)}
                    </span>
                    <span className="kpi__label">Bounce rate</span>
                </div>
            </div>

            <section className="card">
                <div className="card-body card-body--flush">
                    <PagesTable rows={rows} baseUrl={baseUrl} dense />
                </div>
            </section>
        </>
    );
}
