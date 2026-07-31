import { useEffect, useMemo, useRef, useState } from "react";
import {
    useLoaderData,
    useSearchParams,
    type LoaderFunctionArgs,
    type MetaFunction,
} from "react-router";

import Icon, { channelIcon } from "~/components/Icon";
import { requireAuth } from "~/lib/auth";
import { listSites, type Site } from "~/sites/sites";
import {
    choosePreferredSite,
    SITE_COOKIE_NAME,
} from "~/lib/site-preference";

export const meta: MetaFunction = () => [
    { title: "Real-time — GT Analytics" },
];

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);

    const sites = await listSites(context.cloudflare.env.SITES_DB);
    const url = new URL(request.url);

    return {
        sites,
        siteId:
            url.searchParams.get("site") ||
            choosePreferredSite(
                request,
                sites.map((s) => s.site_id),
                sites[0]?.site_id || "",
            ),
        configured: Boolean(context.cloudflare.env.REALTIME),
    };
}

interface Snapshot {
    activeVisitors: number;
    viewsLastMinute: number;
    viewsInWindow: number;
    conversionsInWindow: number;
    perMinute: { minute: number; views: number; visitors: number }[];
    topPaths: [string, number][];
    topChannels: [string, number][];
    topReferrers: [string, number][];
    topCountries: [string, number][];
    feed: {
        t: number;
        path?: string;
        channel?: string;
        referrerHost?: string;
        country?: string;
        kind?: string;
        name?: string;
    }[];
    now: number;
}

type Status = "connecting" | "live" | "unavailable";

export default function Realtime() {
    const { sites, siteId, configured } = useLoaderData<typeof loader>();
    const [searchParams, setSearchParams] = useSearchParams();
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [status, setStatus] = useState<Status>("connecting");
    const sourceRef = useRef<EventSource | null>(null);

    const activeSite = searchParams.get("site") || siteId;

    useEffect(() => {
        if (!configured || !activeSite) return;

        const source = new EventSource(
            `/realtime/stream?site=${encodeURIComponent(activeSite)}`,
        );
        sourceRef.current = source;

        source.addEventListener("snapshot", (event) => {
            setSnapshot(JSON.parse((event as MessageEvent).data));
            setStatus("live");
        });
        source.addEventListener("unavailable", () => {
            setStatus("unavailable");
        });
        // EventSource reconnects on its own; surface the gap meanwhile rather
        // than leaving a stale number looking current.
        source.onerror = () => setStatus("connecting");

        return () => {
            source.close();
            sourceRef.current = null;
        };
    }, [activeSite, configured]);

    const site = sites.find((s: Site) => s.site_id === activeSite);
    const baseUrl = site?.base_url;

    return (
        <>
            <header className="app-head">
                <div>
                    <h1>
                        <Icon name="bolt" size={26} className="icon--inline" />{" "}
                        Real-time
                    </h1>
                    <p>
                        Everyone on the site in the last five minutes, updated
                        every two seconds.
                    </p>
                </div>
                <div className="app-actions">
                    <StatusPill status={status} configured={configured} />
                </div>
            </header>

            <div className="toolbar">
                <label className="visually-hidden" htmlFor="rt-site">
                    Site
                </label>
                <select
                    id="rt-site"
                    className="select"
                    value={activeSite}
                    onChange={(e) => {
                        document.cookie = `${SITE_COOKIE_NAME}=${encodeURIComponent(e.target.value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
                        setSearchParams({ site: e.target.value });
                    }}
                >
                    {sites.map((s: Site) => (
                        <option key={s.site_id} value={s.site_id}>
                            {s.label}
                        </option>
                    ))}
                </select>
            </div>

            {!configured ? (
                <div className="card">
                    <div className="empty-state">
                        <Icon name="triangle-exclamation" size={28} />
                        <h3>Real-time is not configured</h3>
                        <p>
                            The REALTIME Durable Object binding is missing from
                            this deployment. Historical reports are unaffected.
                        </p>
                    </div>
                </div>
            ) : (
                <>
                    <div className="kpis">
                        <Kpi
                            icon="users"
                            primary
                            value={snapshot?.activeVisitors}
                            label="Active now"
                            hint="Distinct people in the last 5 minutes"
                        />
                        <Kpi
                            icon="eye"
                            value={snapshot?.viewsLastMinute}
                            label="Views this minute"
                        />
                        <Kpi
                            icon="gauge-high"
                            value={snapshot?.viewsInWindow}
                            label="Views (30 min)"
                        />
                        <Kpi
                            icon="bullseye-arrow"
                            value={snapshot?.conversionsInWindow}
                            label="Conversions (30 min)"
                        />
                    </div>

                    <section className="card">
                        <header className="card-head">
                            <h2>Last 30 minutes</h2>
                        </header>
                        <div className="card-body">
                            <Sparkline data={snapshot?.perMinute ?? []} />
                        </div>
                    </section>

                    <div className="grid-cards grid-cards--2">
                        <TopCard
                            title="Pages"
                            icon="file-lines"
                            rows={snapshot?.topPaths ?? []}
                            linkBase={baseUrl}
                        />
                        <TopCard
                            title="Channels"
                            icon="share-nodes"
                            rows={snapshot?.topChannels ?? []}
                            withChannelIcon
                        />
                    </div>

                    <div className="grid-cards grid-cards--2">
                        <TopCard
                            title="Referrers"
                            icon="link"
                            rows={snapshot?.topReferrers ?? []}
                        />
                        <TopCard
                            title="Countries"
                            icon="globe"
                            rows={snapshot?.topCountries ?? []}
                        />
                    </div>

                    <LiveFeed
                        feed={snapshot?.feed ?? []}
                        now={snapshot?.now ?? Date.now()}
                        baseUrl={baseUrl}
                    />
                </>
            )}
        </>
    );
}

function StatusPill({
    status,
    configured,
}: {
    status: Status;
    configured: boolean;
}) {
    if (!configured) {
        return <span className="pill pill--muted">Off</span>;
    }
    if (status === "live") {
        return (
            <span className="pill pill--ok live-pill">
                <span className="live-dot" aria-hidden="true" />
                Live
            </span>
        );
    }
    if (status === "unavailable") {
        return <span className="pill pill--warn">No data yet</span>;
    }
    return <span className="pill pill--muted">Connecting…</span>;
}

function Kpi({
    icon,
    value,
    label,
    hint,
    primary,
}: {
    icon: Parameters<typeof Icon>[0]["name"];
    value?: number;
    label: string;
    hint?: string;
    primary?: boolean;
}) {
    return (
        <div className={primary ? "kpi kpi--primary" : "kpi"}>
            <span className="kpi__icon">
                <Icon name={icon} size={15} />
            </span>
            <span
                className="kpi__value"
                aria-live={primary ? "polite" : undefined}
            >
                {value === undefined ? "—" : value.toLocaleString()}
            </span>
            <span className="kpi__label">{label}</span>
            {hint && <span className="kpi__hint">{hint}</span>}
        </div>
    );
}

function Sparkline({
    data,
}: {
    data: { minute: number; views: number; visitors: number }[];
}) {
    const max = useMemo(
        () => Math.max(1, ...data.map((d) => d.views)),
        [data],
    );

    if (data.length === 0) {
        return <p className="is-loading">Waiting for the first hit…</p>;
    }

    return (
        <div className="sparkline" role="img" aria-label={`Views per minute over the last ${data.length} minutes`}>
            {data.map((d) => (
                <div
                    key={d.minute}
                    className="sparkline__bar"
                    style={{ "--h": d.views / max } as React.CSSProperties}
                    title={`${d.views} views`}
                />
            ))}
        </div>
    );
}

function TopCard({
    title,
    icon,
    rows,
    linkBase,
    withChannelIcon,
}: {
    title: string;
    icon: Parameters<typeof Icon>[0]["name"];
    rows: [string, number][];
    linkBase?: string | null;
    withChannelIcon?: boolean;
}) {
    return (
        <section className="card">
            <header className="card-head">
                <h2>
                    <Icon name={icon} size={14} className="icon--inline" />{" "}
                    {title}
                </h2>
            </header>
            <div className="card-body card-body--flush">
                {rows.length === 0 ? (
                    <div className="empty-state">
                        <p>Nothing in the last 30 minutes.</p>
                    </div>
                ) : (
                    <div className="table-wrap">
                        <table className="data-table data-table--dense">
                            <tbody>
                                {rows.map(([key, count]) => (
                                    <tr key={key}>
                                        <td className="col-main">
                                            <span className="row-label__content">
                                                {withChannelIcon && (
                                                    <Icon
                                                        name={channelIcon(key)}
                                                        size={13}
                                                    />
                                                )}
                                                <span className="truncate">
                                                    {key || "(direct)"}
                                                </span>
                                                {linkBase &&
                                                    key.startsWith("/") && (
                                                        <a
                                                            href={`${linkBase}${key}`}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="row-label__open"
                                                            aria-label={`Open ${key}`}
                                                        >
                                                            <Icon
                                                                name="arrow-up-right-from-square"
                                                                size={12}
                                                            />
                                                        </a>
                                                    )}
                                            </span>
                                        </td>
                                        <td className="num">{count}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </section>
    );
}

function LiveFeed({
    feed,
    now,
    baseUrl,
}: {
    feed: Snapshot["feed"];
    now: number;
    baseUrl?: string | null;
}) {
    return (
        <section className="card">
            <header className="card-head">
                <h2>
                    <Icon name="signal-stream" size={14} className="icon--inline" />{" "}
                    Live feed
                </h2>
            </header>
            <div className="card-body card-body--flush">
                {feed.length === 0 ? (
                    <div className="empty-state">
                        <p>No activity yet.</p>
                    </div>
                ) : (
                    <ul className="feed">
                        {feed.map((item, i) => (
                            <li
                                key={`${item.t}-${i}`}
                                className={
                                    item.kind === "conversion"
                                        ? "feed__item feed__item--conversion"
                                        : "feed__item"
                                }
                            >
                                <span className="feed__icon">
                                    <Icon
                                        name={
                                            item.kind === "conversion"
                                                ? "bullseye-arrow"
                                                : channelIcon(
                                                      item.channel || "direct",
                                                  )
                                        }
                                        size={14}
                                    />
                                </span>
                                <span className="feed__main truncate">
                                    {item.kind === "conversion" ? (
                                        <strong>{item.name}</strong>
                                    ) : baseUrl && item.path ? (
                                        <a
                                            href={`${baseUrl}${item.path}`}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            {item.path}
                                        </a>
                                    ) : (
                                        item.path || "/"
                                    )}
                                </span>
                                <span className="feed__meta">
                                    {item.referrerHost || item.channel || "direct"}
                                </span>
                                <span className="feed__meta feed__country">
                                    {item.country || ""}
                                </span>
                                <time className="feed__time">
                                    {relativeTime(item.t, now)}
                                </time>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}

/** Uses the server clock so a skewed client does not show negative ages. */
function relativeTime(then: number, now: number): string {
    const seconds = Math.max(0, Math.round((now - then) / 1000));
    if (seconds < 5) return "now";
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m`;
}
