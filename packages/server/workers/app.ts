import type { 
    ExecutionContext,
    ExportedHandler,
    ScheduledController,
} from "@cloudflare/workers-types";
import { createRequestHandler, type ServerBuild } from "react-router";

/**
 * NOTE: Must use relative paths inside this file (no ~ shorthand), because
 * it gets packaged into Worker and special paths defined in tsconfig will not
 * resolve.
 */
import { getLoadContext } from "../app/load-context";
import * as build from "../build/server";
import { extractAsArrow } from "./lib/arrow";
import { loader as apiIndex } from "../app/routes/api.v1._index";
import { loader as apiSites } from "../app/routes/api.v1.sites";
import { loader as apiAnalytics } from "../app/routes/api.v1.analytics";
import { loader as apiRealtime } from "../app/routes/api.v1.realtime";
import { loader as apiOpenApi } from "../app/routes/api.v1.openapi";

// Durable Object classes must be exported from the Worker entry point.
export { RealtimeSite } from "./realtime";

const requestHandler = createRequestHandler(build as unknown as ServerBuild);

export default {
        async scheduled(
        _controller: ScheduledController,
        env: Env,
        ctx: ExecutionContext,
    ) {
        if (env.CF_STORAGE_ENABLED === "false") return
        // NOTE: the catch must hang off the promise, not wrap the waitUntil
        // call. waitUntil returns synchronously, so a try/catch around it only
        // ever sees construction errors -- a rejection inside extractAsArrow
        // would go unreported.
        ctx.waitUntil(
            extractAsArrow(
                {
                    accountId: env.CF_ACCOUNT_ID,
                    bearerToken: env.CF_BEARER_TOKEN,
                    dataset: env.CF_AE_DATASET,
                },
                env.DAILY_ROLLUPS,
            ).catch((error) => {
                console.error("daily rollup failed", error);
            }),
        );
    },
    // @ts-expect-error TODO figure out types here
    async fetch(request: any, env: any, ctx: any) {
        try {
            const loadContext = getLoadContext({
                request,
                context: {
                    cloudflare: {
                        ctx: {
                            waitUntil: ctx.waitUntil.bind(ctx),
                            passThroughOnException:
                                ctx.passThroughOnException.bind(ctx),
                            props: ctx.props,
                        },
                        cf: request.cf as never,
                        // @ts-expect-error TODO: figure out how to get this type to work
                        caches,
                        env,
                    },
                },
            });
            // React Router document requests render the root HTML shell even
            // for loader-only routes. Third-party clients need ordinary HTTP
            // JSON, so dispatch the stable public API before document routing.
            if (new URL(request.url).pathname.startsWith("/api/v1")) {
                return await handleApiRequest(request, loadContext);
            }
            return await requestHandler(request, loadContext);
        } catch (error) {
            if (error instanceof Response) return error;
            console.log(error);
            return new Response("An unexpected error occurred", {
                status: 500,
            });
        }
    },
} satisfies ExportedHandler<Env>;

async function handleApiRequest(request: Request, context: ReturnType<typeof getLoadContext>) {
    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    const args = { request, context, params: {} } as never;
    switch (path) {
        case "/api/v1":
            return apiIndex(args);
        case "/api/v1/sites":
            return apiSites(args);
        case "/api/v1/analytics":
            return apiAnalytics(args);
        case "/api/v1/realtime":
            return apiRealtime(args);
        case "/api/v1/openapi":
            return apiOpenApi(args);
        default:
            return Response.json({ error: "not_found" }, {
                status: 404,
                headers: { "Cache-Control": "no-store" },
            });
    }
}
