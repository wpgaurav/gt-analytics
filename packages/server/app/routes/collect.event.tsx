import { LoaderFunctionArgs } from "react-router";

import { buildEventDataPoint, writeEventDataPoint } from "~/analytics/events";
import { extractParamsFromQueryString } from "~/analytics/collect";
import {
    pushRealtimeHit,
    visitorKey,
} from "~/analytics/realtime-client";

/**
 * /collect/event -- custom events and conversions.
 *
 * A GET with query parameters rather than a JSON POST, for the same reason the
 * pageview collector is: `navigator.sendBeacon` and an image request both
 * survive the page being unloaded, which is exactly when a conversion on a
 * form submit or an outbound click fires.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
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
