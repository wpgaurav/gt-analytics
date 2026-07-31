import {
    Form,
    Link,
    redirect,
    useActionData,
    useLoaderData,
    useNavigation,
    useSearchParams,
    type ActionFunctionArgs,
    type LoaderFunctionArgs,
} from "react-router";

import SiteForm from "~/components/SiteForm";
import { requireAuth } from "~/lib/auth";
import {
    deleteSite,
    getSite,
    listSyncState,
    upsertSite,
    validateSiteInput,
} from "~/content/sites";
import { formToSiteInput } from "~/content/site-form";
import { syncSite } from "~/content/wp-sync";

interface PostTypeCount {
    post_type: string;
    n: number;
}

export async function loader({ context, params, request }: LoaderFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);

    const db: D1Database = context.cloudflare.env.CONTENT_DB;
    const siteId = params.siteId!;
    const site = await getSite(db, siteId);

    if (!site) {
        throw new Response("Site not found", { status: 404 });
    }

    const [syncState, counts, mapValue] = await Promise.all([
        listSyncState(db, siteId),
        db
            .prepare(
                `SELECT post_type, COUNT(*) AS n FROM content
                  WHERE site_id = ? GROUP BY post_type ORDER BY n DESC`,
            )
            .bind(siteId)
            .all(),
        context.cloudflare.env.CONTENT_MAP.get(`map:${siteId}`),
    ]);

    return {
        site,
        syncState,
        counts: (counts.results ?? []) as unknown as PostTypeCount[],
        // Only the size matters here; parsing a few hundred KB to count keys on
        // every page load would be wasteful.
        mapBytes: mapValue ? mapValue.length : 0,
    };
}

export async function action({ context, params, request }: ActionFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);

    const env = context.cloudflare.env;
    const siteId = params.siteId!;
    const form = await request.formData();
    const intent = String(form.get("intent") || "save");

    const existing = await getSite(env.CONTENT_DB, siteId);
    if (!existing) {
        throw new Response("Site not found", { status: 404 });
    }

    if (intent === "delete") {
        await deleteSite(env.CONTENT_DB, siteId);
        await env.CONTENT_MAP.delete(`map:${siteId}`);
        return redirect("/admin/sites");
    }

    if (intent === "sync") {
        const result = await syncSite(env.CONTENT_DB, env.CONTENT_MAP, existing);
        if (result.status === "error") {
            const detail = result.types
                .filter((t) => t.status === "error")
                .map((t) => `${t.postType}: ${t.error}`)
                .join("; ");
            return { error: result.error || detail || "Sync failed." };
        }
        const skipped = result.types.reduce((n, t) => n + t.skipped, 0);
        return {
            notice:
                `Synced ${result.totalWritten} items across ${result.types.length} post types. ${result.mapEntries} paths mapped.` +
                (skipped
                    ? ` ${skipped} skipped — no addressable URL (query-string permalinks).`
                    : ""),
        };
    }

    // Save. The ID is immutable, so ignore whatever the readonly input posted.
    const { input, values } = formToSiteInput(form);
    input.site_id = siteId;

    const errors = validateSiteInput(input);
    if (Object.keys(errors).length > 0) {
        return { errors, values };
    }

    await upsertSite(env.CONTENT_DB, input);
    return { notice: "Saved." };
}

export default function EditSite() {
    const { site, syncState, counts, mapBytes } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const [searchParams] = useSearchParams();

    const busy = navigation.state === "submitting";
    const intent = busy
        ? String(navigation.formData?.get("intent") || "")
        : "";

    const justCreated = searchParams.get("created") === "1";
    const totalContent = counts.reduce(
        (sum: number, row: PostTypeCount) => sum + Number(row.n),
        0,
    );

    return (
        <>
            <header className="app-head">
                <div>
                    <p className="kicker">
                        <Link to="/admin/sites">Sites</Link>
                    </p>
                    <h1>{site.label}</h1>
                    <p className="mono">{site.site_id}</p>
                </div>
                <div className="app-actions">
                    {site.wp_sync_enabled === 1 && site.wp_base_url && (
                        <Form method="post">
                            <button
                                className="btn btn-secondary"
                                name="intent"
                                value="sync"
                                disabled={busy}
                            >
                                {intent === "sync" ? "Syncing…" : "Sync now"}
                            </button>
                        </Form>
                    )}
                </div>
            </header>

            {justCreated && (
                <div className="flash flash--ok">
                    Site added. Run the first sync to build its content map —
                    the initial pull can take a minute on a large site.
                </div>
            )}
            {actionData?.notice && (
                <div className="flash flash--ok">{actionData.notice}</div>
            )}
            {actionData?.error && (
                <div className="flash flash--error">{actionData.error}</div>
            )}

            <div className="kpis stack-md">
                <div className="kpi kpi--primary">
                    <span className="kpi__value">
                        {totalContent.toLocaleString()}
                    </span>
                    <span className="kpi__label">Items mapped</span>
                </div>
                <div className="kpi">
                    <span className="kpi__value">{counts.length}</span>
                    <span className="kpi__label">Post types</span>
                </div>
                <div className="kpi">
                    <span className="kpi__value">
                        {mapBytes ? `${Math.round(mapBytes / 1024)} KB` : "—"}
                    </span>
                    <span className="kpi__label">Edge map size</span>
                </div>
            </div>

            <SiteForm
                site={site}
                errors={actionData?.errors}
                values={actionData?.values}
                busy={busy && intent === "save"}
            />

            {syncState.length > 0 && (
                <div className="card">
                    <div className="card-head">
                        <h2>Sync status by post type</h2>
                    </div>
                    <div className="card-body card-body--flush">
                        <div className="table-wrap">
                            <table className="data-table data-table--dense">
                                <thead>
                                    <tr>
                                        <th className="col-main">Post type</th>
                                        <th className="num">Mapped</th>
                                        <th>Last run</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {syncState.map((row) => {
                                        const state = row as Record<
                                            string,
                                            string | number | null
                                        >;
                                        const type = String(state.post_type);
                                        const mapped = counts.find(
                                            (c: PostTypeCount) =>
                                                c.post_type === type,
                                        );
                                        return (
                                            <tr key={type}>
                                                <td className="col-main">
                                                    <div className="cell-stack">
                                                        <span>{type}</span>
                                                        <span className="cell-sub mono">
                                                            /wp-json/wp/v2/
                                                            {String(
                                                                state.rest_base ??
                                                                    "",
                                                            )}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="num">
                                                    {mapped
                                                        ? Number(
                                                              mapped.n,
                                                          ).toLocaleString()
                                                        : "—"}
                                                </td>
                                                <td className="cell-sub">
                                                    {state.last_run_at
                                                        ? `${state.last_run_at} UTC`
                                                        : "never"}
                                                </td>
                                                <td>
                                                    {state.last_status ===
                                                    "error" ? (
                                                        <span
                                                            className="pill pill--error"
                                                            title={String(
                                                                state.last_error ??
                                                                    "",
                                                            )}
                                                        >
                                                            Error
                                                        </span>
                                                    ) : (
                                                        <span className="pill pill--ok">
                                                            OK
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            <div className="card">
                <div className="card-head">
                    <h2>Danger zone</h2>
                </div>
                <div className="card-body">
                    <p className="muted">
                        Removing a site deletes its content map, taxonomy and
                        sync state. Recorded analytics are keyed by site ID in
                        Analytics Engine and are not touched — they simply stop
                        resolving to posts.
                    </p>
                    <Form
                        method="post"
                        onSubmit={(event) => {
                            if (
                                !confirm(
                                    `Remove ${site.label}? Its content map will be deleted.`,
                                )
                            ) {
                                event.preventDefault();
                            }
                        }}
                    >
                        <button
                            className="btn btn-danger btn-sm"
                            name="intent"
                            value="delete"
                            disabled={busy}
                        >
                            Remove site
                        </button>
                    </Form>
                </div>
            </div>
        </>
    );
}
