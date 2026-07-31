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
import InstallSnippet from "~/components/InstallSnippet";
import { requireAuth } from "~/lib/auth";
import {
    deleteSite,
    getSite,
    upsertSite,
    validateSiteInput,
} from "~/sites/sites";
import { formToSiteInput } from "~/sites/site-form";

export async function loader({ context, params, request }: LoaderFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);

    const db: D1Database = context.cloudflare.env.SITES_DB;
    const site = await getSite(db, params.siteId!);

    if (!site) {
        throw new Response("Site not found", { status: 404 });
    }

    return { site, origin: new URL(request.url).origin };
}

export async function action({ context, params, request }: ActionFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);

    const db: D1Database = context.cloudflare.env.SITES_DB;
    const siteId = params.siteId!;
    const form = await request.formData();
    const intent = String(form.get("intent") || "save");

    const existing = await getSite(db, siteId);
    if (!existing) {
        throw new Response("Site not found", { status: 404 });
    }

    if (intent === "delete") {
        await deleteSite(db, siteId);
        return redirect("/admin/sites");
    }

    // Save. The ID is immutable, so ignore whatever the readonly input posted.
    const { input, values } = formToSiteInput(form);
    input.site_id = siteId;

    const errors = validateSiteInput(input);
    if (Object.keys(errors).length > 0) {
        return { errors, values };
    }

    await upsertSite(db, input);
    return { notice: "Saved." };
}

export default function EditSite() {
    const { site, origin } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const [searchParams] = useSearchParams();

    const busy = navigation.state === "submitting";
    const intent = busy ? String(navigation.formData?.get("intent") || "") : "";
    const justCreated = searchParams.get("created") === "1";

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
                    <Link
                        className="btn btn-secondary"
                        to={`/dashboard?site=${encodeURIComponent(site.site_id)}`}
                    >
                        View reports
                    </Link>
                </div>
            </header>

            {justCreated && (
                <div className="flash flash--ok">
                    Site added. Install the snippet below and the first hits
                    will appear within a minute.
                </div>
            )}
            {actionData?.notice && (
                <div className="flash flash--ok">{actionData.notice}</div>
            )}

            <div className="card">
                <div className="card-head">
                    <h2>Install</h2>
                </div>
                <div className="card-body">
                    <InstallSnippet origin={origin} siteId={site.site_id} />
                </div>
            </div>

            <SiteForm
                site={site}
                errors={actionData?.errors}
                values={actionData?.values}
                busy={busy && intent === "save"}
            />

            <div className="card">
                <div className="card-head">
                    <h2>Danger zone</h2>
                </div>
                <div className="card-body">
                    <p className="muted">
                        Removing a site only removes its name and URL. Recorded
                        analytics are keyed by site ID in Analytics Engine and
                        are not touched — they simply stop resolving to a label
                        and clickable links.
                    </p>
                    <Form
                        method="post"
                        onSubmit={(event) => {
                            if (!confirm(`Remove ${site.label}?`)) {
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
