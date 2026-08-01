import { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { buildEventDataPoint, writeEventDataPoint } from "~/analytics/events";
import { extractParamsFromQueryString } from "~/analytics/collect";
import {
    pushRealtimeHit,
    visitorKey,
} from "~/analytics/realtime-client";

/**
 * /collect/event -- custom events and conversions.
 *
 * Parameters live in the query string for both supported transports:
 * `navigator.sendBeacon` sends a POST, while the image fallback sends a GET.
 * Both survive page teardown, which is exactly when duration and conversion
 * events usually fire.
 */
async function collectEvent(
    request: Request,
    context: LoaderFunctionArgs["context"],
) {
    const params = extractParamsFromQueryString(request.url);
    const cf = context.cloudflare.cf as Record<string, unknown> | undefined;

    const result = buildEventDataPoint(params, {
        country: typeof cf?.country === "string" ? cf.country : undefined,
    });

    if ("error" in result) {
        return new Response(result.error, {
            status: 400,
            headers: { "Access-Control-Allow-Origin": "*" },
        });
    }

    const env = context.cloudflare.env;
    writeEventDataPoint(env.EVENTS_AE, result);

    // Conversions show up in the live feed too -- seeing one land is the whole
    // appeal of a real-time view.
    if (context.cloudflare.ctx && env.REALTIME) {
        context.cloudflare.ctx.waitUntil(
            visitorKey(
                result.siteId,
                request,
                env.CF_REALTIME_SALT || env.CF_JWT_SECRET || "gt-analytics",
            )
                .then((visitor) =>
                    pushRealtimeHit(env.REALTIME, {
                        siteId: result.siteId,
                        visitor,
                        path: result.path,
                        channel: result.channel,
                        referrerHost: result.referrerHost,
                        country: result.country,
                        kind: result.type,
                        name: result.name,
                    }),
                )
                .catch((error) => {
                    console.error("realtime fan-out failed", error);
                }),
        );
    }

    // 204 rather than the pageview collector's GIF: nothing embeds this as an
    // image, and an empty body is cheaper than a pixel.
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Tk: "N", // not tracking
        },
    });
}

/** Image fallback transport. */
export async function loader({ request, context }: LoaderFunctionArgs) {
    return collectEvent(request, context);
}

/** `navigator.sendBeacon` transport. */
export async function action({ request, context }: ActionFunctionArgs) {
    return collectEvent(request, context);
}
