import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { isbot } from "isbot";

import { extractParamsFromQueryString } from "~/analytics/collect";
import { pushRealtimeHit, visitorKey } from "~/analytics/realtime-client";

/** Visible-tab heartbeat. Never written to Analytics Engine. */
async function collectPresence(
    request: Request,
    context: LoaderFunctionArgs["context"],
) {
    const params = extractParamsFromQueryString(request.url);
    const siteId = (params.sid || "").trim();
    if (!siteId) {
        return new Response("Missing siteId", {
            status: 400,
            headers: { "Access-Control-Allow-Origin": "*" },
        });
    }

    if (isbot(request.headers.get("user-agent") || "")) {
        return new Response(null, { status: 204 });
    }

    const env = context.cloudflare.env;
    if (context.cloudflare.ctx && env.REALTIME) {
        context.cloudflare.ctx.waitUntil(
            visitorKey(
                siteId,
                request,
                env.CF_REALTIME_SALT || env.CF_JWT_SECRET || "gt-analytics",
            ).then((visitor) =>
                pushRealtimeHit(env.REALTIME, {
                    siteId,
                    visitor,
                    path: params.p,
                    country:
                        typeof context.cloudflare.cf?.country === "string"
                            ? context.cloudflare.cf.country
                            : undefined,
                    kind: "presence",
                }),
            ).catch(() => undefined),
        );
    }

    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Tk: "N",
        },
    });
}

export async function loader({ request, context }: LoaderFunctionArgs) {
    return collectPresence(request, context);
}

export async function action({ request, context }: ActionFunctionArgs) {
    return collectPresence(request, context);
}
