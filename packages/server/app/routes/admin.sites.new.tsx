import {
    Link,
    redirect,
    useActionData,
    useNavigation,
    type ActionFunctionArgs,
    type LoaderFunctionArgs,
} from "react-router";

import SiteForm from "~/components/SiteForm";
import { requireAuth } from "~/lib/auth";
import { siteIdExists, upsertSite, validateSiteInput } from "~/sites/sites";
import { formToSiteInput } from "~/sites/site-form";

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);
    return {};
}

export async function action({ context, request }: ActionFunctionArgs) {
    const user = await requireAuth(request, context.cloudflare.env);

    const db: D1Database = context.cloudflare.env.SITES_DB;
    const form = await request.formData();
    const { input, values } = formToSiteInput(form);

    const errors = validateSiteInput(input);

    // Creating over an existing ID would silently overwrite that site's
    // configuration, so treat it as a validation failure rather than an upsert.
    if (!errors.site_id && (await siteIdExists(db, input.site_id))) {
        errors.site_id = "A site with this ID already exists.";
    }

    if (Object.keys(errors).length > 0) {
        return { errors, values };
    }

    await upsertSite(db, user.accountId!, input);
    return redirect(
        `/admin/sites/${encodeURIComponent(input.site_id)}?created=1`,
    );
}

export default function NewSite() {
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();

    return (
        <>
            <header className="app-head">
                <div>
                    <p className="kicker">
                        <Link to="/admin/sites">Sites</Link>
                    </p>
                    <h1>Add a site</h1>
                    <p>
                        Tracking starts as soon as the snippet is installed.
                        Adding the site here names it in the dashboard and makes
                        its recorded paths link back to the live page.
                    </p>
                </div>
            </header>

            <SiteForm
                errors={actionData?.errors}
                values={actionData?.values}
                busy={navigation.state === "submitting"}
            />
        </>
    );
}
