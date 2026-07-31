import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";

import { requireAuth } from "~/lib/auth";
import { listSites, type Site } from "~/sites/sites";

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);
    return { sites: await listSites(context.cloudflare.env.SITES_DB) };
}

export default function AdminSites() {
    const { sites } = useLoaderData<typeof loader>();

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
                    <Link className="btn btn-secondary" to="/admin/settings">
                        Install &amp; tracking
                    </Link>
                    <Link className="btn btn-primary" to="/admin/sites/new">
                        Add site
                    </Link>
                </div>
            </header>

            {sites.length === 0 ? (
                <div className="card">
                    <div className="empty-state">
                        <h3>No sites yet</h3>
                        <p>
                            Adding a site gives its recorded hits a name in the
                            dashboard and makes report rows link back to the
                            live page. Tracking works without one; the reports
                            are just less useful.
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
                                        <th>URL</th>
                                        <th>Timezone</th>
                                        <th aria-label="Actions" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {sites.map((site: Site) => (
                                        <tr key={site.site_id}>
                                            <td className="col-main">
                                                <div className="cell-stack">
                                                    <Link
                                                        to={`/admin/sites/${encodeURIComponent(site.site_id)}`}
                                                    >
                                                        {site.label}
                                                    </Link>
                                                    <span className="cell-sub mono">
                                                        {site.site_id}
                                                    </span>
                                                </div>
                                            </td>
                                            <td>
                                                {site.enabled === 1 ? (
                                                    <span className="pill pill--ok">
                                                        Active
                                                    </span>
                                                ) : (
                                                    <span className="pill pill--muted">
                                                        Disabled
                                                    </span>
                                                )}
                                            </td>
                                            <td>
                                                {site.base_url ? (
                                                    <a
                                                        href={site.base_url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="cell-sub"
                                                    >
                                                        {site.base_url.replace(
                                                            /^https?:\/\//,
                                                            "",
                                                        )}
                                                    </a>
                                                ) : (
                                                    <span className="cell-sub muted">
                                                        not set
                                                    </span>
                                                )}
                                            </td>
                                            <td className="cell-sub">
                                                {site.timezone}
                                            </td>
                                            <td>
                                                <div className="cell-actions">
                                                    <Link
                                                        className="btn btn-ghost btn-sm"
                                                        to={`/admin/sites/${encodeURIComponent(site.site_id)}`}
                                                    >
                                                        Edit
                                                    </Link>
                                                </div>
                                            </td>
                                        </tr>
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
