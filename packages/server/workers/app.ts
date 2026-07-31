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
import { syncAllSites } from "../app/content/wp-sync";

const requestHandler = createRequestHandler(build as unknown as ServerBuild);

/** Cron expression for the hourly WordPress content sync. */
const CONTENT_SYNC_CRON = "17 * * * *";

export default {
        async scheduled(
        controller: ScheduledController,
        env: Env,
        ctx: ExecutionContext,
    ) {
        // Two schedules share this handler; dispatch on which one fired rather
        // than running both jobs every time.
        if (controller.cron === CONTENT_SYNC_CRON) {
            ctx.waitUntil(
                syncAllSites(env.CONTENT_DB, env.CONTENT_MAP)
                    .then((results) => {
                        for (const result of results) {
                            if (result.status === "error") {
                                console.error(
                                    `content sync failed for ${result.siteId}:`,
                                    result.error ??
                                        result.types
                                            .filter((t) => t.status === "error")
                                            .map((t) => `${t.postType}: ${t.error}`)
                                            .join("; "),
                                );
                            }
                        }
                    })
                    .catch((error) => {
                        console.error("content sync failed", error);
                    }),
            );
            return;
        }

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
            return await requestHandler(request, loadContext);
        } catch (error) {
            console.log(error);
            return new Response("An unexpected error occurred", {
                status: 500,
            });
        }
    },
} satisfies ExportedHandler<Env>;
