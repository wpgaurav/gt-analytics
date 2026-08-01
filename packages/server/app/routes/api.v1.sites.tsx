import type { LoaderFunctionArgs } from "react-router";
import { requireApiAuth } from "~/lib/api-auth";
import { apiJson } from "~/lib/api-input";
import { getSite, listSites } from "~/sites/sites";

export async function loader({ request, context }: LoaderFunctionArgs) {
    const principal = await requireApiAuth(request, context.cloudflare.env, "analytics:read");
    const sites = principal.siteId
        ? [await getSite(context.cloudflare.env.SITES_DB, principal.accountId, principal.siteId)].filter((site) => site !== null)
        : await listSites(context.cloudflare.env.SITES_DB, principal.accountId);
    return apiJson({
        data: sites.map(({ site_id, label, base_url, timezone, enabled, live_from }) => ({
            id: site_id, label, baseUrl: base_url, timezone, enabled: enabled === 1, liveFrom: live_from,
        })),
    });
}
