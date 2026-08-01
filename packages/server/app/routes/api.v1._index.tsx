import type { LoaderFunctionArgs } from "react-router";
import { requireApiAuth } from "~/lib/api-auth";
import { apiJson } from "~/lib/api-input";

export async function loader({ request, context }: LoaderFunctionArgs) {
    await requireApiAuth(request, context.cloudflare.env, "analytics:read");
    const origin = new URL(request.url).origin;
    return apiJson({
        name: "GT Analytics API",
        version: "v1",
        authentication: "Authorization: Bearer gta_…",
        endpoints: {
            sites: `${origin}/api/v1/sites`,
            analytics: `${origin}/api/v1/analytics?site=SITE_ID&interval=7d`,
            realtime: `${origin}/api/v1/realtime?site=SITE_ID`,
            openapi: `${origin}/api/v1/openapi`,
        },
    });
}
