import type { LoaderFunctionArgs } from "react-router";

import { requireApiAuth } from "~/lib/api-auth";
import { readRealtimeSnapshot } from "~/analytics/realtime-client";

/** How often a snapshot is pushed to a connected client. */
const TICK_MS = 2000;

/**
 * Server-sent events carrying the real-time snapshot for one site.
 *
 * SSE rather than a WebSocket: this is strictly server-to-client, EventSource
 * reconnects on its own, and there is no upgrade handshake to get wrong. The
 * Durable Object is polled here rather than pushing, so a client that
 * disconnects costs nothing once its stream closes.
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireApiAuth(request, context.cloudflare.env);

    const env = context.cloudflare.env;
    const url = new URL(request.url);
    const siteId = url.searchParams.get("site") || "";

    if (!siteId) {
        return new Response("Missing site", { status: 400 });
    }

    if (!env.REALTIME) {
        return new Response("Realtime is not configured", { status: 501 });
    }

    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream({
        async start(controller) {
            const send = (event: string, data: unknown) => {
                controller.enqueue(
                    encoder.encode(
                        `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
                    ),
                );
            };

            const tick = async () => {
                try {
                    const snapshot = await readRealtimeSnapshot(
                        env.REALTIME,
                        siteId,
                    );
                    if (snapshot) {
                        send("snapshot", snapshot);
                    } else {
                        // Tell the client explicitly rather than going quiet,
                        // so it can distinguish "no data" from "connection
                        // died".
                        send("unavailable", { siteId });
                    }
                } catch {
                    send("unavailable", { siteId });
                }
            };

            await tick();
            timer = setInterval(() => {
                void tick();
            }, TICK_MS);

            // Closing the request aborts the stream; clear the interval or it
            // keeps polling the object for a client that has gone.
            request.signal.addEventListener("abort", () => {
                if (timer) clearInterval(timer);
                try {
                    controller.close();
                } catch {
                    // Already closed.
                }
            });
        },
        cancel() {
            if (timer) clearInterval(timer);
        },
    });

    return new Response(stream, {
        headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-store, must-revalidate",
            connection: "keep-alive",
            // Without this some proxies buffer the whole stream and nothing
            // arrives until it ends.
            "x-accel-buffering": "no",
        },
    });
}
