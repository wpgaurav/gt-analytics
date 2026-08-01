import type { LoaderFunctionArgs } from "react-router";
import { apiJson } from "~/lib/api-input";

export async function loader({ request }: LoaderFunctionArgs) {
    const origin = new URL(request.url).origin;
    return apiJson({
        openapi: "3.1.0",
        info: { title: "GT Analytics API", version: "1.0.0", description: "Read-only, account-scoped analytics for dashboards, WordPress, automations, and AI tools." },
        servers: [{ url: `${origin}/api/v1` }],
        security: [{ bearerAuth: [] }],
        paths: {
            "/sites": { get: { summary: "List sites in the API key's account", responses: { "200": { description: "Sites" } } } },
            "/analytics": { get: { summary: "Get complete analytics for a site", parameters: queryParameters(true), responses: { "200": { description: "Analytics" }, "404": { description: "Site is outside this account" } } } },
            "/realtime": { get: { summary: "Get the current real-time snapshot", parameters: queryParameters(false).slice(0, 1), responses: { "200": { description: "Real-time snapshot" } } } },
        },
        components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "GT Analytics API key" } } },
    });
}

function queryParameters(full: boolean) {
    const params = [
        { name: "site", in: "query", required: true, schema: { type: "string" } },
        { name: "interval", in: "query", required: false, schema: { type: "string", default: "7d", examples: ["today", "7d", "30d", "2026-07-01..2026-07-31"] } },
        { name: "timezone", in: "query", required: false, schema: { type: "string", default: "UTC" } },
        { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
    ];
    return full ? params : params.slice(0, 1);
}
