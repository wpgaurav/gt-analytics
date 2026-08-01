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
        scope: "Each generated API key can access exactly one site.",
        endpoints: {
            sites: `${origin}/api/v1/sites`,
            analytics: `${origin}/api/v1/analytics?interval=7d`,
            realtime: `${origin}/api/v1/realtime`,
            openapi: `${origin}/api/v1/openapi`,
        },
    });
}
