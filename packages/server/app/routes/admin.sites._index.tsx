import {
    Form,
    Link,
    useLoaderData,
    useActionData,
    useNavigation,
    type ActionFunctionArgs,
    type LoaderFunctionArgs,
} from "react-router";

import { requireAuth } from "~/lib/auth";
import {
    deleteSite,
    listSites,
    listSyncSummaries,
    type Site,
    type SiteSyncSummary,
} from "~/content/sites";
import { syncSite } from "~/content/wp-sync";

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);

    const db = context.cloudflare.env.CONTENT_DB;
    const [sites, summaries] = await Promise.all([
        listSites(db),
        listSyncSummaries(db),
    ]);

    return { sites, summaries };
}

export async function action({ context, request }: ActionFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);

    const env = context.cloudflare.env;
    const form = await request.formData();
    const intent = String(form.get("intent") || "");
    const siteId = String(form.get("site_id") || "");

    if (!siteId) {
        return { error: "No site specified." };
    }

    if (intent === "delete") {
        await deleteSite(env.CONTENT_DB, siteId);
        await env.CONTENT_MAP.delete(`map:${siteId}`);
        return { notice: `Removed ${siteId} and its content map.` };
    }

    if (intent === "sync") {
        const sites = await listSites(env.CONTENT_DB);
        const site = sites.find((s) => s.site_id === siteId);
        if (!site) return { error: `Unknown site ${siteId}.` };

        const result = await syncSite(env.CONTENT_DB, env.CONTENT_MAP, site);
        if (result.status === "error") {
            const failed = result.types
                .filter((t) => t.status === "error")
                .map((t) => `${t.postType}: ${t.error}`)
                .join("; ");
            return {
                error:
                    result.error ||
                    `Sync finished with errors. ${failed}`.trim(),
            };
        }
        const skipped = result.types.reduce((n, t) => n + t.skipped, 0);
        return {
            notice:
                `Synced ${siteId}: ${result.totalWritten} items across ${result.types.length} post types, ${result.mapEntries} paths mapped.` +
                (skipped
                    ? ` ${skipped} skipped — no addressable URL (query-string permalinks).`
                    : ""),
        };
    }

    return { error: `Unknown action "${intent}".` };
}

export default function AdminSites() {
    const { sites, summaries } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();

    const busy = navigation.state === "submitting";
    const busySite = busy
        ? String(navigation.formData?.get("site_id") || "")
        : "";
    const busyIntent = busy
        ? String(navigation.formData?.get("intent") || "")
        : "";

    const notice = actionData?.notice;
    const error = actionData?.error;

    return (
        <>
            <header className="app-head">
                <div>
                    <h1>Sites</h1>
                    <p>
                        Every property this deployment tracks. The site ID must
                        match the <code>data-site-id</code> on the tracking
                        snippet, or hits will not be attributed.
                    </p>
                </div>
                <div className="app-actions">
                    <Link className="btn btn-primary" to="/admin/sites/new">
                        Add site
                    </Link>
                </div>
            </header>

            {notice && <div className="flash flash--ok">{notice}</div>}
            {error && <div className="flash flash--error">{error}</div>}

            {sites.length === 0 ? (
                <div className="card">
                    <div className="empty-state">
                        <h3>No sites yet</h3>
                        <p>
                            Add a site to start resolving recorded page paths to
                            real WordPress posts. Analytics are still collected
                            without one, they just will not be attributed to
                            content.
                        </p>
                        <Link className="btn btn-primary" to="/admin/sites/new">
                            Add your first site
                        </Link>
                    </div>
                </div>
            ) : (
                <div className="card">
                    <div className="card-body card-body--flush">
                        <div className="table-wrap">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th className="col-main">Site</th>
                                        <th>Status</th>
                                        <th className="num">Content</th>
                                        <th>Last sync</th>
                                        <th aria-label="Actions" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {sites.map((site) => (
                                        <SiteRow
                                            key={site.site_id}
                                            site={site}
                                            summary={summaries[site.site_id]}
                                            busySite={busySite}
                                            busyIntent={busyIntent}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function SiteRow({
    site,
    summary,
    busySite,
    busyIntent,
}: {
    site: Site;
    summary?: SiteSyncSummary;
    busySite: string;
    busyIntent: string;
}) {
    const isSyncing = busySite === site.site_id && busyIntent === "sync";
    const contentCount = summary?.content_count ?? 0;

    return (
        <tr>
            <td className="col-main">
                <div className="cell-stack">
                    <Link to={`/admin/sites/${encodeURIComponent(site.site_id)}`}>
                        {site.label}
                    </Link>
                    <span className="cell-sub mono">{site.site_id}</span>
                </div>
            </td>
            <td>
                <StatusPill site={site} summary={summary} />
            </td>
            <td className="num">
                {contentCount ? contentCount.toLocaleString() : "—"}
            </td>
            <td>
                <span className="cell-sub">
                    {summary?.last_run_at
                        ? `${summary.last_run_at} UTC`
                        : "never"}
                </span>
            </td>
            <td>
                <div className="cell-actions">
                    {site.wp_sync_enabled === 1 && site.wp_base_url && (
                        <Form method="post">
                            <input
                                type="hidden"
                                name="site_id"
                                value={site.site_id}
                            />
                            <button
                                className="btn btn-secondary btn-sm"
                                name="intent"
                                value="sync"
                                disabled={isSyncing}
                            >
                                {isSyncing ? "Syncing…" : "Sync now"}
                            </button>
                        </Form>
                    )}
                    <Link
                        className="btn btn-ghost btn-sm"
                        to={`/admin/sites/${encodeURIComponent(site.site_id)}`}
                    >
                        Edit
                    </Link>
                </div>
            </td>
        </tr>
    );
}

function StatusPill({
    site,
    summary,
}: {
    site: Site;
    summary?: SiteSyncSummary;
}) {
    if (site.enabled !== 1) {
        return <span className="pill pill--muted">Disabled</span>;
    }
    if (summary?.last_status === "error") {
        return <span className="pill pill--error">Sync error</span>;
    }
    if (site.wp_sync_enabled !== 1) {
        return <span className="pill pill--brand">Paths only</span>;
    }
    if (!summary?.last_run_at) {
        return <span className="pill pill--warn">Never synced</span>;
    }
    return <span className="pill pill--ok">Active</span>;
}
