import type { LoaderFunctionArgs } from "react-router";
import { readRealtimeSnapshot } from "~/analytics/realtime-client";
import { requireApiAuth } from "~/lib/api-auth";
import { apiJson } from "~/lib/api-input";

export async function loader({ request, context }: LoaderFunctionArgs) {
    const principal = await requireApiAuth(request, context.cloudflare.env, "realtime:read");
    const site = new URL(request.url).searchParams.get("site") || principal.siteId || "";
    if (!site) return apiJson({ error: "invalid_request", message: "site is required" }, { status: 400 });
    if (!context.cloudflare.env.REALTIME) return apiJson({ error: "not_configured" }, { status: 501 });
    const snapshot = await readRealtimeSnapshot(context.cloudflare.env.REALTIME, site);
    return apiJson({ data: snapshot ?? { activeVisitors: 0, viewsLastMinute: 0, viewsInWindow: 0, conversionsInWindow: 0, eventsInWindow: 0, perMinute: [], activePages: [], topPaths: [], topChannels: [], topReferrers: [], topCountries: [], feed: [], now: Date.now() } });
}
